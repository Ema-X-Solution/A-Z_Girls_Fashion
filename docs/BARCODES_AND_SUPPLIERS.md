# Barcode printing and supplier accounts

## Printing labels

Open **طباعة الباركود** in the sidebar, or **باركود** beside a product. Select the desired size/color variants and quantities, choose a label size and paper type, then **معاينة الملصقات** followed by **طباعة الملصقات**. Browser print supports saving to PDF before a physical printer is purchased. No silent USB printing or automatic printer selection is attempted.

Presets are 40×30, 50×30 and 60×40 mm; custom sizes allow widths 30–100 mm and heights 25–100 mm. The default is 50×30 mm. Thermal mode prints one label per page. A4 uses a grid with 10 mm page margins and 2 mm gaps; it is suitable for plain sheets or label stock matching those dimensions, not every commercial precut sheet. In the print dialog use 100% scale, turn off browser headers/footers and select matching printer media. Verify one label with the scanner before printing a large batch. Long legacy/supplier barcodes may need wider media. Labels include ten-module horizontal quiet zones for Code 128.

Each variant keeps its unique stored barcode. New internal codes are compact 12-digit numeric values; existing barcodes are never replaced automatically. A batch is limited to 100 variants and 500 labels. The backend resolves actual variant prices/names/options and rejects invalid/inactive selections. Preparing labels is audited and does not deduct stock.

Supplier invoice details include **باركود هذه الدفعة**, which prepares the original received quantities less supplier-return quantities. These quantities are document-based; labels can be reprinted independently of stock. The per-variant **حسب المخزون** button uses current available quantities (up to the batch limit).

## Supplier documents and accounting

Open **الموردون** and choose **كشف الحساب والفواتير**. The account page contains a running statement, receipt-backed invoices and purchase-return history. The equation is:

`opening balance + supplier invoices − supplier payments − purchase-return credits`

A positive balance is payable to the supplier; a negative balance is a credit owed to the store. Payments are recorded against the overall supplier account. Per-invoice payment allocation and combining multiple receipts into an external supplier tax invoice are not implemented.

Every purchase receipt creates a supplier invoice atomically with stock receiving. View the invoice, choose **مرتجع للمورد**, enter eligible quantities and a reason, then approve. The backend checks the original unreturned received quantities and available stock at the receipt's location. It deducts stock and creates the supplier credit in one transaction. It does not claim that a supplier returned cash; a credit remains on the account.

Use **تسجيل سداد** for bank/wallet/card or cash. Cash requires your own open shift and reduces drawer cash. Noncash does not affect drawer cash. Payments above the outstanding balance are rejected. Idempotency keys and serializable transactions prevent duplicate payments/returns and concurrent overpayment/over-return.

Returned inventory leaves at its current weighted average; supplier credit uses original receipt value. Any difference is preserved as valuation variance and affects net profit separately. Original receipt line allocation ensures full returns credit exactly the original invoice total, including cent rounding. Invoice, payment and purchase-return documents are immutable; corrections must use new authorized documents rather than editing posted amounts.

## Verification limits

Automated checks cover APIs, actual PostgreSQL concurrency, browser forms and print CSS/PDF dimensions/page counts. Physical printer stock alignment, thermal density and scanner readability must be tested with the purchased hardware. Production Docker/HTTPS and offsite restore remain separate acceptance tasks.
