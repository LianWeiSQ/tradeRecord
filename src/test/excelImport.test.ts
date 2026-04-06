import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { importWorkbook } from '../services/excelImport'

async function workbookToFile(workbook: XLSX.WorkBook): Promise<File> {
  const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new File([array], 'sample.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('importWorkbook', () => {
  it('parses live and paper sheets into positions', async () => {
    const workbook = XLSX.utils.book_new()

    const liveSheet = XLSX.utils.aoa_to_sheet([
      ['鸡蛋', '', 46022],
      ['JD2602', '', ''],
      ['持仓', '', 2],
      ['C', '', ''],
      ['', 3000, 48],
    ])

    const paperSheet = XLSX.utils.aoa_to_sheet([
      ['燃油', '', 46023],
      ['FU2602', '', ''],
      ['持仓', '', -1],
      ['P', '', ''],
      ['', 2600, 95],
    ])

    const statsSheet = XLSX.utils.aoa_to_sheet([
      [],
      ['', '账户A'],
      ['日期', '本金', '权益', '收益比', '出入金', '收益'],
      [46022, 100000, 102000, 0.02, 0, 2000],
    ])

    XLSX.utils.book_append_sheet(workbook, liveSheet, '鸡蛋JD（实盘）')
    XLSX.utils.book_append_sheet(workbook, paperSheet, '燃油FU（模拟）')
    XLSX.utils.book_append_sheet(workbook, statsSheet, '统计')

    const file = await workbookToFile(workbook)
    const result = await importWorkbook(file)

    expect(result.positions).toHaveLength(2)
    expect(result.positions.map((item) => item.accountType)).toEqual(['live', 'paper'])
    expect(result.importWarnings).toHaveLength(0)
  })

  it('falls back to current holdings matrix when no date-column positions are found', async () => {
    const workbook = XLSX.utils.book_new()

    const sheet = XLSX.utils.aoa_to_sheet([
      ['到期日', -44, '', '', '', '', '', '', '', '', '', ''],
      ['豆油', '', 46027, '', '', '', '', 46037, 46048, 46055, '', '总计'],
      ['Y2605', '', 7860, '', '', '', '', 7900, 8188, '', '', ''],
      ['期货持仓', '', 2, '', '', '', '', -1, -1, '', '', '0'],
      ['C持仓'],
      ['C'],
      [],
      [],
      [],
      [],
      ['P', 7500, '', 64.5, '', '', '', '', '', '', '', ''],
      ['', 7600, '', '', 85.5, '', '', '', '', '', '', ''],
      ['', 7700, '', '', '', 113.5, '', '', '', '', '', ''],
      ['', 7800, '', '', '', '', 148.25, '', '', 84.5, '', ''],
      [],
      ['P持仓', '', '', 1, 1, 1, 2, '', '', -2, -1, -1],
    ])

    XLSX.utils.book_append_sheet(workbook, sheet, '豆油Y（模拟）')

    const file = await workbookToFile(workbook)
    const result = await importWorkbook(file)

    expect(result.positions).toHaveLength(1)
    expect(result.positions[0].strategyName).toContain('当前持仓汇总')
    expect(result.positions[0].legs.length).toBeGreaterThan(1)
    expect(result.importWarnings).toHaveLength(0)
  })
})
