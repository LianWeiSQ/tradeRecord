import writeXlsxFile, { type SheetData } from 'write-excel-file/node'
import { describe, expect, it } from 'vitest'
import { importWorkbook } from '../services/excelImport'

type TestSheet = {
  name: string
  data: SheetData
}

async function workbookToFile(workbook: TestSheet[]): Promise<File> {
  const buffer = await writeXlsxFile(
    workbook.map((sheet) => sheet.data),
    { buffer: true, sheets: workbook.map((sheet) => sheet.name) },
  )

  return new File([buffer], 'sample.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('importWorkbook', () => {
  it('parses live and paper sheets into positions', async () => {
    const file = await workbookToFile([
      {
        name: '鸡蛋JD（实盘）',
        data: [
          ['鸡蛋', '', 46022],
          ['JD2602', '', ''],
          ['持仓', '', 2],
          ['C', '', ''],
          ['', 3000, 48],
        ],
      },
      {
        name: '燃油FU（模拟）',
        data: [
          ['燃油', '', 46023],
          ['FU2602', '', ''],
          ['持仓', '', -1],
          ['P', '', ''],
          ['', 2600, 95],
        ],
      },
      {
        name: '统计',
        data: [
          [],
          ['', '账户A'],
          ['日期', '本金', '权益', '收益比', '出入金', '收益'],
          [46022, 100000, 102000, 0.02, 0, 2000],
        ],
      },
    ])
    const result = await importWorkbook(file)

    expect(result.positions).toHaveLength(2)
    expect(result.positions.map((item) => item.accountType)).toEqual(['live', 'paper'])
    expect(result.importWarnings).toHaveLength(0)
  })

  it('falls back to current holdings matrix when no date-column positions are found', async () => {
    const file = await workbookToFile([
      {
        name: '豆油Y（模拟）',
        data: [
          ['到期日', -44, '', '', '', '', '', '', '', '', '', ''],
          ['豆油', '', '参考A', '', '', '', '', '参考B', '参考C', '参考D', '', '总计'],
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
        ],
      },
    ])
    const result = await importWorkbook(file)

    expect(result.positions).toHaveLength(1)
    expect(result.positions[0].strategyName).toContain('当前持仓汇总')
    expect(result.positions[0].legs.length).toBeGreaterThan(1)
    expect(result.importWarnings).toHaveLength(0)
  })
})
