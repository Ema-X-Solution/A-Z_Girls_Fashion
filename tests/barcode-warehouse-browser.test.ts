import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { pickSmartOption } from "./smart-select";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome", headless: true });
  await mkdir("test-results/barcode-warehouse", { recursive: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>((done) => web?.httpServer.close(() => done())); });
it.each([1440, 390])("warehouse filter uses selected balances, includes zero and clears selection at %spx", async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const locations = [{id:"loc-1",name:"المخزن الرئيسي"},{id:"loc-2",name:"مخزن الفرع"}];
  const supplier = {id:"sup-1",name:"مورد الأقمشة"};
  const variant = (i:number, balances: any[]) => ({id:`v${i}`,sku:`VAR-${i}`,barcode:`20123456789${i}`,price:"100.00",active:true,options:{المقاس:"M",اللون:"أحمر"},balances});
  const products = [{id:"p1",nameAr:"فستان بناتي",variants:[variant(1,[{locationId:"loc-1",quantity:4},{locationId:"loc-2",quantity:8}]),variant(2,[{locationId:"loc-1",quantity:0}]),variant(3,[{locationId:"loc-2",quantity:2}])]}];
  let lastQuery = "";
  await page.route("**/api/**", async route => {
    const req=new URL(route.request().url()),path=req.pathname;let data:any=[];
    if(path==="/api/auth/me") data={id:"owner",name:"مدير تجريبي",roles:["OWNER"],permissions:["products.view","barcodes.print"],csrf:"test"};
    else if(path==="/api/branding"||path==="/api/public/store")data={name:"A&Z Girls Fashion"};
    else if(path==="/api/options/locations") {await route.fulfill({json:{data:locations,hasMore:false,selected:locations.find(x=>x.id===req.searchParams.get("selected"))}});return;}
    else if(path==="/api/options/suppliers"){await route.fulfill({json:{data:[supplier],hasMore:false,selected:supplier}});return;}
    else if(path==="/api/products"){lastQuery=req.search;await route.fulfill({json:{data:products,total:1}});return;}
    else if(path==="/api/barcodes/print-labels")data={storeName:"A&Z Girls Fashion",items:route.request().postDataJSON().items.map((x:any)=>({...products[0].variants.find(v=>v.id===x.variantId),variantId:x.variantId,name:products[0].nameAr,supplierCode:"SUP-0001",quantity:x.quantity}))};
    await route.fulfill({json:{data}});
  });
  try {
    await page.goto(`${url}/products/barcodes`);
    const all=page.getByRole("checkbox",{name:"اختيار كل الظاهر في الصفحة",exact:true});
    const qty=(i:number)=>page.getByRole("spinbutton",{name:`عدد ملصقات VAR-${i}`,exact:true});
    await all.check();await ui(qty(1)).toHaveValue("12");
    await page.getByRole("button",{name:"معاينة الملصقات",exact:true}).click();
    await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(14);
    await pickSmartOption(page,"المخزن",locations[0].name);
    await ui(all).not.toBeChecked();await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(0);
    await ui(qty(3)).toHaveCount(0);await all.check();await ui(qty(1)).toHaveValue("4");await ui(qty(2)).toHaveValue("0");
    expect(lastQuery).toContain("locationId=loc-1");
    await pickSmartOption(page,"تصفية حسب المورد الأساسي",supplier.name);
    await ui(all).not.toBeChecked();await all.check();expect(lastQuery).toContain("supplierId=sup-1");expect(lastQuery).toContain("locationId=loc-1");
    for(const theme of ["light","dark"]){await page.evaluate(async t=>{document.documentElement.dataset.theme=t;window.scrollTo(0,0);await document.fonts.ready;await new Promise(requestAnimationFrame);},theme);await page.screenshot({path:`test-results/barcode-warehouse/after-${width}-${theme}.png`,fullPage:true});}
    await pickSmartOption(page,"المخزن",locations[1].name);await ui(qty(2)).toHaveCount(0);await all.check();await ui(qty(1)).toHaveValue("8");await ui(qty(3)).toHaveValue("2");
    await page.getByRole("button",{name:"مسح المخزن",exact:true}).click();await all.check();await ui(qty(1)).toHaveValue("12");await ui(qty(2)).toHaveValue("0");
  }finally{await page.close();}
});
