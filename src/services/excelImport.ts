import * as XLSX from 'xlsx'
import { isoNow, toNumber } from './format'
import type {
  AccountType,
  DailyStat,
  ExcelImportResult,
  OptionType,
  StrategyLegInput,
  StrategyPositionInput,
} from '../types/trade'

type Cell = string | number | boolean | Date | null | undefined
type Matrix = Cell[][]

interface ParseContext {
  warnings: string[]
  notes: string[]
}

function asRows(sheet: XLSX.WorkSheet): Matrix {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
  }) as Matrix
}

function isExcelDate(value: unknown): value is number {
  return typeof value === 'number' && value > 40000 && value < 60000
}

function excelDateToIso(value: number): string {
  const parsed = XLSX.SSF.parse_date_code(value)
  if (!parsed) {
    return new Date().toISOString().slice(0, 10)
  }

  const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d))
  return date.toISOString().slice(0, 10)
}

function stringValue(value: unknown): string {
  if (value == null) {
    return ''
  }

  return String(value).trim()
}

function firstContractInMatrix(rows: Matrix): string {
  const matcher = /\b[A-Z]{1,5}\d{3,4}\b/

  for (const row of rows.slice(0, 6)) {
    for (const cell of row) {
      const text = stringValue(cell)
      const matched = text.match(matcher)
      if (matched) {
        return matched[0]
      }
    }
  }

  return ''
}

function inferAccountType(sheetName: string, warnings: string[]): AccountType {
  if (sheetName.includes('实盘')) {
    return 'live'
  }
  if (sheetName.includes('模拟')) {
    return 'paper'
  }

  warnings.push(`${sheetName}: 未从工作表名称识别到账户类型，默认按模拟导入。`)
  return 'paper'
}

function inferProduct(sheetName: string): string {
  return sheetName.replace(/（.*?）|\(.*?\)/g, '').replaceAll(',', ' / ').trim()
}

function buildOptionLeg(params: {
  contractCode: string
  optionType: OptionType
  side: 'long' | 'short'
  strikePrice?: number
  entryPrice: number
  qty: number
  createdAt: string
  note?: string
}): StrategyLegInput {
  return {
    instrumentType: 'option',
    side: params.side,
    contractCode: params.contractCode,
    optionType: params.optionType,
    strikePrice: params.strikePrice,
    qty: params.qty,
    entryPrice: params.entryPrice,
    multiplier: 1,
    createdAt: params.createdAt,
    note: params.note,
  }
}

function buildFutureLeg(params: {
  contractCode: string
  side: 'long' | 'short'
  qty: number
  entryPrice: number
  createdAt: string
  note?: string
}): StrategyLegInput {
  return {
    instrumentType: 'future',
    side: params.side,
    contractCode: params.contractCode,
    optionType: null,
    qty: params.qty,
    entryPrice: params.entryPrice,
    multiplier: 1,
    createdAt: params.createdAt,
    note: params.note,
  }
}

function makePosition(args: {
  accountType: AccountType
  product: string
  underlyingSymbol: string
  strategyName: string
  openedAt: string
  remarks?: string
  importNotes?: string[]
  legs: StrategyLegInput[]
}): StrategyPositionInput | null {
  if (!args.legs.length) {
    return null
  }

  return {
    accountType: args.accountType,
    product: args.product,
    underlyingSymbol: args.underlyingSymbol,
    strategyName: args.strategyName,
    openedAt: args.openedAt,
    thesis: '',
    plan: '',
    expectedScenario: '',
    reviewResult: '',
    reviewConclusion: '',
    tags: ['Excel 导入'],
    remarks: args.remarks ?? '从固定模板导入',
    importNotes: args.importNotes ?? [],
    legs: args.legs,
  }
}

function parseRowWiseBlocks(sheetName: string, rows: Matrix, context: ParseContext): StrategyPositionInput[] {
  const accountType = inferAccountType(sheetName, context.warnings)
  const product = inferProduct(sheetName)
  const positions: StrategyPositionInput[] = []

  const configs = sheetName.includes('液化气')
    ? [
        {
          label: '左侧',
          dateCol: 0,
          underlyingCol: 1,
          futureQtyCol: 2,
          optionPriceCols: [3, 4, 5],
          strikeRow: 2,
          optionQtyCol: 6,
          noteCol: 10,
          underlyingSymbol: stringValue(rows[1]?.[1]) || firstContractInMatrix(rows),
          optionHeader: stringValue(rows[1]?.[3]),
          product,
        },
        {
          label: '右侧',
          dateCol: 11,
          optionPriceCols: [12, 13, 14, 15],
          strikeRow: 2,
          underlyingSymbol: stringValue(rows[1]?.[11]) || 'FU',
          optionHeader: stringValue(rows[1]?.[12]),
          product: '燃油',
        },
      ]
    : [
        {
          label: '主区',
          dateCol: 0,
          underlyingCol: 1,
          futureQtyCol: 2,
          optionPriceCols: [4, 5, 6, 7, 8],
          strikeRow: 1,
          optionQtyCol: 9,
          noteCol: 10,
          underlyingSymbol: stringValue(rows[0]?.[1]) || firstContractInMatrix(rows),
          optionHeader: stringValue(rows[0]?.[3]),
          product,
        },
      ]

  for (const config of configs) {
    const optionType =
      config.optionHeader.includes('-P') || config.optionHeader.endsWith('P') ? 'P' : 'C'
    const strikeMap = new Map<number, number>()

    for (const col of config.optionPriceCols) {
      const strike = toNumber(rows[config.strikeRow]?.[col])
      if (strike != null) {
        strikeMap.set(col, strike)
      }
    }

    for (let rowIndex = config.strikeRow + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const dateSerial = row[config.dateCol]
      if (!isExcelDate(dateSerial)) {
        continue
      }

      const openedAt = excelDateToIso(dateSerial)
      const futurePrice =
        'underlyingCol' in config && config.underlyingCol !== undefined
          ? toNumber(row[config.underlyingCol])
          : undefined
      const futureQtyValue =
        'futureQtyCol' in config && config.futureQtyCol !== undefined
          ? toNumber(row[config.futureQtyCol])
          : undefined
      const optionQtyValue =
        'optionQtyCol' in config && config.optionQtyCol !== undefined
          ? toNumber(row[config.optionQtyCol])
          : undefined
      const note =
        'noteCol' in config && config.noteCol !== undefined
          ? stringValue(row[config.noteCol])
          : ''
      const legs: StrategyLegInput[] = []

      if (futurePrice != null && futureQtyValue != null && futureQtyValue !== 0) {
        legs.push(
          buildFutureLeg({
            contractCode: config.underlyingSymbol || product,
            side: futureQtyValue > 0 ? 'long' : 'short',
            qty: Math.abs(futureQtyValue),
            entryPrice: futurePrice,
            createdAt: openedAt,
          }),
        )
      }

      for (const col of config.optionPriceCols) {
        const price = toNumber(row[col])
        if (price == null) {
          continue
        }

        const qtyBase = optionQtyValue == null || optionQtyValue === 0 ? 1 : Math.abs(optionQtyValue)
        legs.push(
          buildOptionLeg({
            contractCode: config.optionHeader || `${config.underlyingSymbol}${optionType}`,
            optionType,
            side: optionQtyValue != null && optionQtyValue < 0 ? 'short' : 'long',
            strikePrice: strikeMap.get(col),
            entryPrice: price,
            qty: qtyBase,
            createdAt: openedAt,
          }),
        )
      }

      const position = makePosition({
        accountType,
        product: config.product,
        underlyingSymbol: config.underlyingSymbol || product,
        strategyName: `${config.product} ${openedAt} ${config.label}`,
        openedAt,
        remarks: note,
        importNotes: note ? [note] : [],
        legs,
      })

      if (position) {
        positions.push(position)
      }
    }
  }

  return positions
}

function parseMatrixSheet(sheetName: string, rows: Matrix, context: ParseContext): StrategyPositionInput[] {
  const accountType = inferAccountType(sheetName, context.warnings)
  const product = inferProduct(sheetName)
  const positions: StrategyPositionInput[] = []
  const contractCode = firstContractInMatrix(rows)
  const candidateCols = new Set<number>()

  for (let rowIndex = 0; rowIndex < Math.min(4, rows.length); rowIndex += 1) {
    const row = rows[rowIndex] ?? []
    for (let col = 0; col < row.length; col += 1) {
      if (isExcelDate(row[col])) {
        candidateCols.add(col)
      }
    }
  }

  const futureQtyRow = rows.findIndex((row) => stringValue(row[0]).includes('期货持仓'))
  const genericQtyRow = rows.findIndex((row) => stringValue(row[0]).includes('持仓'))

  for (const col of [...candidateCols].sort((left, right) => left - right)) {
    const rawDate = rows[0]?.[col] ?? rows[1]?.[col] ?? rows[2]?.[col]
    if (!isExcelDate(rawDate)) {
      continue
    }

    const openedAt = excelDateToIso(rawDate)
    const legs: StrategyLegInput[] = []
    const futureQty =
      futureQtyRow >= 0 ? toNumber(rows[futureQtyRow]?.[col]) : toNumber(rows[genericQtyRow]?.[col])
    const underlyingPrice = toNumber(rows[2]?.[col]) ?? toNumber(rows[1]?.[col])

    if (futureQty != null && futureQty !== 0 && underlyingPrice != null && contractCode) {
      legs.push(
        buildFutureLeg({
          contractCode,
          side: futureQty > 0 ? 'long' : 'short',
          qty: Math.abs(futureQty),
          entryPrice: underlyingPrice,
          createdAt: openedAt,
        }),
      )
    }

    let currentOptionType: OptionType | null = null
    let sectionQty = toNumber(rows[genericQtyRow]?.[col])

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const marker = stringValue(row[0])

      if (marker === 'C' || marker === 'P') {
        currentOptionType = marker
        sectionQty = toNumber(rows[Math.max(rowIndex - 1, 0)]?.[col]) ?? sectionQty
        continue
      }

      const strikePrice = toNumber(row[1])
      const price = toNumber(row[col])
      if (currentOptionType && strikePrice != null && price != null) {
        const qtyBase = sectionQty == null || sectionQty === 0 ? 1 : Math.abs(sectionQty)
        legs.push(
          buildOptionLeg({
            contractCode: contractCode || product,
            optionType: currentOptionType,
            side: sectionQty != null && sectionQty < 0 ? 'short' : 'long',
            strikePrice,
            entryPrice: price,
            qty: qtyBase,
            createdAt: openedAt,
          }),
        )
      }
    }

    const position = makePosition({
      accountType,
      product,
      underlyingSymbol: contractCode || product,
      strategyName: `${product} ${openedAt}`,
      openedAt,
      legs,
    })

    if (position) {
      positions.push(position)
    }
  }

  return positions
}

function findLatestSheetDate(rows: Matrix): string {
  const values: number[] = []

  for (let rowIndex = 0; rowIndex < Math.min(4, rows.length); rowIndex += 1) {
    for (const cell of rows[rowIndex] ?? []) {
      if (isExcelDate(cell)) {
        values.push(cell)
      }
    }
  }

  if (!values.length) {
    return new Date().toISOString().slice(0, 10)
  }

  return excelDateToIso(Math.max(...values))
}

function parseCurrentHoldingsMatrixSheet(
  sheetName: string,
  rows: Matrix,
  context: ParseContext,
): StrategyPositionInput[] {
  const accountType = inferAccountType(sheetName, context.warnings)
  const product = inferProduct(sheetName)
  const contractCode = firstContractInMatrix(rows) || product
  const openedAt = findLatestSheetDate(rows)
  const legs: StrategyLegInput[] = []

  const futureQtyRow = rows.findIndex((row) => stringValue(row[0]).includes('期货持仓'))
  if (futureQtyRow >= 0) {
    const priceRow = Math.max(futureQtyRow - 1, 0)
    const row = rows[futureQtyRow] ?? []
    for (let col = 1; col < row.length; col += 1) {
      const qty = toNumber(row[col])
      const price = toNumber(rows[priceRow]?.[col])
      if (qty != null && qty !== 0 && price != null) {
        legs.push(
          buildFutureLeg({
            contractCode,
            side: qty > 0 ? 'long' : 'short',
            qty: Math.abs(qty),
            entryPrice: price,
            createdAt: openedAt,
            note: '来自当前持仓矩阵',
          }),
        )
      }
    }
  }

  const sectionStarts = rows
    .map((row, index) => ({ marker: stringValue(row[0]), index }))
    .filter((item) => item.marker === 'C' || item.marker === 'P')

  for (const section of sectionStarts) {
    const optionType = section.marker as OptionType
    const holdingsRowIndex = rows.findIndex(
      (row, index) => index < section.index && stringValue(row[0]) === `${optionType}持仓`,
    )
    if (holdingsRowIndex < 0) {
      continue
    }

    const holdingsRow = rows[holdingsRowIndex] ?? []
    const endIndex = rows.findIndex(
      (row, index) =>
        index > section.index &&
        ['C', 'P', '开仓基差', '平仓基差', '百分比', '预估收益', '总盈亏'].includes(
          stringValue(row[0]),
        ),
    )
    const stopIndex = endIndex > section.index ? endIndex : rows.length

    for (let rowIndex = section.index + 1; rowIndex < stopIndex; rowIndex += 1) {
      const strikePrice = toNumber(rows[rowIndex]?.[1])
      if (strikePrice == null) {
        continue
      }

      for (let col = 2; col < (rows[rowIndex] ?? []).length; col += 1) {
        const qty = toNumber(holdingsRow[col])
        const price = toNumber(rows[rowIndex]?.[col])
        if (qty != null && qty !== 0 && price != null) {
          legs.push(
            buildOptionLeg({
              contractCode,
              optionType,
              side: qty > 0 ? 'long' : 'short',
              strikePrice,
              entryPrice: price,
              qty: Math.abs(qty),
              createdAt: openedAt,
              note: '来自当前持仓矩阵',
            }),
          )
        }
      }
    }
  }

  const position = makePosition({
    accountType,
    product,
    underlyingSymbol: contractCode,
    strategyName: `${product} 当前持仓汇总`,
    openedAt,
    remarks: '从当前持仓矩阵汇总生成',
    importNotes: ['该记录由当前持仓矩阵汇总生成，不代表逐笔开仓流水。'],
    legs,
  })

  return position ? [position] : []
}

function parseStatsSheet(rows: Matrix): DailyStat[] {
  const stats: DailyStat[] = []
  const headerRow = rows[2] ?? []
  const labelRow = rows[1] ?? []
  const blockStarts: number[] = []

  for (let col = 1; col < headerRow.length - 1; col += 1) {
    if (stringValue(headerRow[col]) === '本金' && stringValue(headerRow[col + 1]) === '权益') {
      blockStarts.push(col)
    }
  }

  for (const start of blockStarts) {
    const sourceLabel = stringValue(labelRow[start]) || `统计列 ${start + 1}`

    for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? []
      const rawDate = row[0]
      if (!isExcelDate(rawDate)) {
        continue
      }

      const principal = toNumber(row[start])
      const equity = toNumber(row[start + 1])
      if (principal == null || equity == null) {
        continue
      }

      stats.push({
        id: crypto.randomUUID(),
        date: excelDateToIso(rawDate),
        sourceLabel,
        principal,
        equity,
        returnRatio: toNumber(row[start + 2]) ?? 0,
        cashFlow: toNumber(row[start + 3]) ?? 0,
        profit: toNumber(row[start + 4]) ?? 0,
      })
    }
  }

  return stats
}

function parseSummaryNotes(rows: Matrix): string[] {
  return rows
    .map((row) => row.map(stringValue).filter(Boolean).join(' | '))
    .filter(Boolean)
    .slice(0, 40)
}

export async function importWorkbook(file: File): Promise<ExcelImportResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const context: ParseContext = { warnings: [], notes: [] }
  const positions: StrategyPositionInput[] = []
  const stats: DailyStat[] = []

  for (const sheetName of workbook.SheetNames) {
    const rows = asRows(workbook.Sheets[sheetName])

    if (sheetName === '统计') {
      stats.push(...parseStatsSheet(rows))
      continue
    }

    if (sheetName === '总结') {
      context.notes.push(...parseSummaryNotes(rows))
      continue
    }

    if (['总表', 'Sheet1', 'Sheet2'].includes(sheetName)) {
      context.notes.push(`${sheetName}: 已作为辅助信息跳过结构化导入。`)
      continue
    }

    if (sheetName.includes('股指') || sheetName.includes('液化气')) {
      positions.push(...parseRowWiseBlocks(sheetName, rows, context))
      continue
    }

    const parsed = parseMatrixSheet(sheetName, rows, context)
    if (parsed.length) {
      positions.push(...parsed)
      continue
    }

    const currentHoldings = parseCurrentHoldingsMatrixSheet(sheetName, rows, context)
    if (currentHoldings.length) {
      context.notes.push(`${sheetName}: 已按当前持仓矩阵方式补充导入。`)
      positions.push(...currentHoldings)
      continue
    }

    context.warnings.push(`${sheetName}: 没有识别到可导入的日期列或当前持仓矩阵。`)
  }

  context.notes.unshift(`导入时间: ${isoNow()}`)

  return {
    positions,
    stats,
    importWarnings: context.warnings,
    importNotes: context.notes,
  }
}
