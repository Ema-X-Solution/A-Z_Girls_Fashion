import { describe, expect, it, vi } from 'vitest';
import { dashboardData } from '../apps/api/src/controllers/reports.controller.js';
import { D } from '../apps/api/src/utils/money.js';

describe('cashier VAT totals', () => {
  it('keeps identical names in separate accounts and subtracts returns including VAT from the original seller', async () => {
    const from = new Date('2026-11-01T00:00:00Z'), to = new Date('2026-11-30T23:59:59Z');
    const user = (id: string) => ({ id, name: 'Same name', employeeCode: id });
    const sale = (id: string, net: number) => ({ userId: id, user: user(id), taxMode: 'EXCLUSIVE', taxRate: D(14), subtotal: D(net), discount: D(0), netBeforeTax: D(net), tax: D(net * .14), total: D(net * 1.14), createdAt: from, items: [], payments: [] });
    const tx: any = {
      sale: { findMany: vi.fn().mockResolvedValue([sale('A', 100), sale('B', 200)]) },
      saleReturn: { findMany: vi.fn().mockResolvedValue([{ id: 'R', total: D(57) }, { id: 'OLD', total: D(114) }]) },
      saleReturnItem: { findMany: vi.fn().mockResolvedValue([
        { amount: D(57), tax: D(7), sellable: false, saleItem: { sale: { userId: 'A', user: user('A') } } },
        { amount: D(114), tax: D(14), sellable: false, saleItem: { sale: { userId: 'C', user: user('C') } } },
      ]) },
    };
    const data = await dashboardData(tx, { id: 'owner', permissions: ['sales.view_all'] } as any, from, to);
    expect(data.cashiers).toHaveLength(3);
    expect(data.cashiers.find((c: any) => c.id === 'A')).toMatchObject({ invoices: 1, grossSales: '57.00', netSales: '50.00', sellerCode: 'A' });
    expect(data.cashiers.find((c: any) => c.id === 'B')).toMatchObject({ grossSales: '228.00' });
    expect(data.cashiers.find((c: any) => c.id === 'C')).toMatchObject({ invoices: 0, grossSales: '-114.00' });
    expect(data.cashiers.reduce((sum: number, c: any) => sum + Number(c.grossSales), 0)).toBe(Number(data.totalSalesWithTax));
    expect(tx.saleReturn.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { createdAt: { gte: from, lte: to } } }));
  });
});
