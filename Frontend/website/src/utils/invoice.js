import QRCode from "qrcode";

const SELLER = {
  name: process.env.NEXT_PUBLIC_SELLER_NAME || "LUCENT BIOTECH LTD (UNIT-II)",
  addressLine1: process.env.NEXT_PUBLIC_SELLER_ADDR_1 || "16/5, NALHERA AJANTPUR",
  addressLine2: process.env.NEXT_PUBLIC_SELLER_ADDR_2 || "PURANA IQBALPUR ROAD, ROORKEE-247667",
  addressLine3: process.env.NEXT_PUBLIC_SELLER_ADDR_3 || "DISTT. HARIDWAR, UTTARAKHAND",
  cin: process.env.NEXT_PUBLIC_SELLER_CIN || "U24232UP2005PLC029816",
  state: process.env.NEXT_PUBLIC_SELLER_STATE || "UTTARAKHAND",
  stateCode: process.env.NEXT_PUBLIC_SELLER_STATE_CODE || "05",
  gstin: process.env.NEXT_PUBLIC_SELLER_GSTIN || "05AABCL0886F2ZN",
  pan: process.env.NEXT_PUBLIC_SELLER_PAN || "AABCL0886F",
  phone: process.env.NEXT_PUBLIC_SELLER_PHONE || "+91 41111111",
  email: process.env.NEXT_PUBLIC_SELLER_EMAIL || "info@lucent.in",
  licenseNo: process.env.NEXT_PUBLIC_SELLER_LICENSE || "43/UA/2016,45/UA/SC/P/2016",
};

const BANK = {
  bankName: process.env.NEXT_PUBLIC_SELLER_BANK_NAME || "HDFC BANK",
  branch: process.env.NEXT_PUBLIC_SELLER_BANK_BRANCH || "PRANAY TOWERS, LUCKNOW",
  accountNo: process.env.NEXT_PUBLIC_SELLER_BANK_ACCOUNT || "50200013663375",
  ifsc: process.env.NEXT_PUBLIC_SELLER_BANK_IFSC || "HDFC0000594",
};

const TERMS = [
  "Goods once sold will not be taken back or exchanged.",
  "Bills not paid by due date will attract 24% interest.",
  "All disputes subject to ROORKEE jurisdiction only.",
];

const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (value) => Math.round((toNum(value) + Number.EPSILON) * 100) / 100;
const round3 = (value) => Math.round((toNum(value) + Number.EPSILON) * 1000) / 1000;

const fmt2 = (value) => round2(value).toFixed(2);
const fmt3 = (value) => round3(value).toFixed(3);

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const formatDate = (dateLike) => {
  const d = new Date(dateLike || Date.now());
  if (Number.isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatDateTime = (dateLike) => {
  const d = new Date(dateLike || Date.now());
  if (Number.isNaN(d.getTime())) return "-";
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(d)} AT ${hh}:${mi}`;
};

const getInvoiceNo = (order) => {
  const raw = text(order?.invoiceNo || "");
  if (raw) return raw;
  return `L25-${String(order?._id || "").slice(-6).toUpperCase() || "000000"}`;
};

const getOrderNo = (order) => {
  const idTail = String(order?._id || "").slice(-8).toUpperCase();
  return idTail ? `ORD-${idTail}` : "AS PER P.O.";
};

const getBuyer = (order, buyer = {}) => {
  const shipping = order?.shippingAddress || {};
  return {
    name: text(buyer?.shopName || buyer?.name || shipping?.shopName || "PARTY NAME"),
    address: text(shipping?.address || buyer?.address || ""),
    city: text(shipping?.city || buyer?.city || ""),
    state: text(shipping?.state || buyer?.state || ""),
    pincode: text(shipping?.pincode || buyer?.pincode || ""),
    phone: text(buyer?.phone || shipping?.phone || ""),
    gstin: text(buyer?.gstNumber || ""),
    dlNo: text(buyer?.drugLicenseNumber || ""),
    cstNo: text(buyer?.cstNumber || ""),
  };
};

const inWordsUnder1000 = (n) => {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const value = Math.floor(Math.max(0, n));
  if (value < 20) return ones[value];
  if (value < 100) {
    const t = Math.floor(value / 10);
    const r = value % 10;
    return `${tens[t]}${r ? ` ${ones[r]}` : ""}`.trim();
  }
  const h = Math.floor(value / 100);
  const r = value % 100;
  return `${ones[h]} Hundred${r ? ` ${inWordsUnder1000(r)}` : ""}`.trim();
};

const amountToWords = (amount) => {
  const total = round2(amount);
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  const chunks = [];
  if (crore) chunks.push(`${inWordsUnder1000(crore)} Crore`);
  if (lakh) chunks.push(`${inWordsUnder1000(lakh)} Lakh`);
  if (thousand) chunks.push(`${inWordsUnder1000(thousand)} Thousand`);
  if (rest) chunks.push(inWordsUnder1000(rest));

  const rupeeWords = `${chunks.join(" ").trim()} Rupees`;
  if (!paise) return `${rupeeWords} Only`;
  return `${rupeeWords} and ${inWordsUnder1000(paise)} Paise Only`;
};

const waitForBlob = (stream) =>
  new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(stream.toBlob("application/pdf")));
    stream.on("error", reject);
  });

const triggerBrowserDownload = (blob, filename) => {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
};

const buildRows = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];

  return items.map((item, idx) => {
    const qty = Math.max(0, toNum(item?.quantity || 0));
    const ptr = round2(item?.price || 0);
    const mrp = round2(item?.mrp || ptr || 0);
    const gstPct = Math.max(0, toNum(item?.gstPercent || 0));
    const tGst = round3(gstPct / 2);
    const gross = round2(ptr * qty);

    return {
      st: idx + 1,
      hsn: text(item?.hsnCode || "30049099"),
      productName: text(item?.productName || "PRODUCT NAME"),
      pUnit: text(item?.packing || "1X10X1"),
      batchNo: text(item?.batchNo || "-"),
      mfg: text(item?.mfg || "-"),
      exp: text(item?.exp || "-"),
      mrp,
      ptr,
      caseWeight: "0.000KGS",
      cases: qty,
      qty,
      unit: text(item?.unit || "BOX"),
      rate: ptr,
      tGst,
      value: gross,
      amount: gross,
    };
  });
};

const drawCell = (doc, x, y, w, h, value, opts = {}) => {
  const font = opts.font || "Helvetica";
  const size = opts.size || 7;
  const align = opts.align || "left";
  const pad = opts.pad ?? 2;

  doc.rect(x, y, w, h).stroke("#111111");
  doc.font(font).fontSize(size).fillColor("#111111").text(String(value ?? ""), x + pad, y + 2, {
    width: Math.max(0, w - pad * 2),
    align,
    lineBreak: false,
    ellipsis: true,
  });
};

export async function downloadOrderInvoicePdf(order, options = {}) {
  if (!order || typeof window === "undefined") return;

  const [{ default: PDFDocument }, blobStreamModule] = await Promise.all([
    import("pdfkit/js/pdfkit.standalone"),
    import("blob-stream"),
  ]);
  const blobStream = blobStreamModule?.default || blobStreamModule;

  const buyer = getBuyer(order, options?.buyer || {});
  const rows = buildRows(order);

  const totalAmount = round2(rows.reduce((s, r) => s + r.amount, 0) || order?.payableAmount || 0);
  const totalQty = rows.reduce((s, r) => s + toNum(r.qty), 0);

  const qrDataUrl = await QRCode.toDataURL(
    `INV:${getInvoiceNo(order)}\nORDER:${getOrderNo(order)}\nDATE:${formatDate(order?.createdAt)}\nAMOUNT:${fmt2(totalAmount)}`,
    { width: 96, margin: 0 }
  );

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 10, compress: true });
  const stream = doc.pipe(blobStream());

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 10;
  const fullW = pageW - margin * 2;

  doc.rect(margin, margin, fullW, pageH - margin * 2).stroke("#111111");

  let y = margin;

  const topH = 112;
  const leftW = Math.round(fullW * 0.42);
  const midW = Math.round(fullW * 0.26);
  const rightW = fullW - leftW - midW;

  drawCell(doc, margin, y, leftW, topH, "");
  drawCell(doc, margin + leftW, y, midW, topH, "");
  drawCell(doc, margin + leftW + midW, y, rightW, topH, "");

  let ly = y + 4;
  doc.font("Helvetica-Bold").fontSize(12).text(SELLER.name, margin + 4, ly, { width: leftW - 8 });
  ly += 14;
  doc.font("Helvetica").fontSize(7).text(SELLER.addressLine1, margin + 4, ly, { width: leftW - 8 });
  ly += 9;
  doc.text(SELLER.addressLine2, margin + 4, ly, { width: leftW - 8 });
  ly += 9;
  doc.text(SELLER.addressLine3, margin + 4, ly, { width: leftW - 8 });
  ly += 9;
  doc.text(`CIN: ${SELLER.cin}`, margin + 4, ly, { width: leftW - 8 });
  ly += 9;
  doc.text(`GSTIN: ${SELLER.gstin}`, margin + 4, ly, { width: leftW - 8 });
  ly += 9;
  doc.text(`PHONE: ${SELLER.phone}`, margin + 4, ly, { width: leftW - 8 });
  ly += 9;
  doc.text(`E-MAIL: ${SELLER.email}`, margin + 4, ly, { width: leftW - 8 });
  ly += 9;
  doc.text(`STATE : ${SELLER.state} - ${SELLER.stateCode}`, margin + 4, ly, { width: leftW - 8 });
  doc.font("Helvetica").fontSize(6).fillColor("#1d4ed8").text(`Licence No.: ${SELLER.licenseNo}`, margin + 4, y + topH - 12, { width: leftW - 8 });

  doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827").text("GST INVOICE", margin + leftW, y + 8, {
    width: midW,
    align: "center",
  });
  if (qrDataUrl) {
    doc.image(qrDataUrl, margin + leftW + (midW - 64) / 2, y + 30, { fit: [64, 64] });
  }

  const rx = margin + leftW + midW + 4;
  let ry = y + 4;
  doc.font("Helvetica").fontSize(7).fillColor("#111111");
  doc.text("Party Name :", rx, ry);
  doc.font("Helvetica-Bold").text(buyer.name || "-", rx + 58, ry, { width: rightW - 64 });
  ry += 10;
  doc.font("Helvetica").text("", rx, ry);
  doc.text(`${buyer.address || "-"}`, rx + 58, ry, { width: rightW - 64 });
  ry += 9;
  doc.text(`${[buyer.city, buyer.state].filter(Boolean).join(", ")} ${buyer.pincode}`.trim(), rx + 58, ry, { width: rightW - 64 });
  ry += 10;
  doc.text("PHONE. :", rx, ry);
  doc.text(buyer.phone || "-", rx + 58, ry, { width: rightW - 64 });
  ry += 10;
  doc.text("GSTIN :", rx, ry);
  doc.text(buyer.gstin || "-", rx + 58, ry, { width: rightW - 64 });
  ry += 10;
  doc.text("Delivery At :", rx, ry);
  doc.text(`${buyer.city || "-"}, ${buyer.state || "-"}`.trim(), rx + 58, ry, { width: rightW - 64 });
  ry += 10;
  doc.text("DL NO:", rx, ry);
  doc.text(buyer.dlNo || "-", rx + 58, ry, { width: rightW - 64 });
  ry += 10;
  doc.text("CSTIN:", rx, ry);
  doc.text(buyer.cstNo || "-", rx + 58, ry, { width: rightW - 64 });

  y += topH;

  const metaH = 58;
  drawCell(doc, margin, y, fullW, metaH, "");

  const metaRows = [
    [
      ["Invoice No.", getInvoiceNo(order)],
      ["L.R. No.", text(order?.lrNo || "-")],
      ["Invoice Date", formatDate(order?.createdAt)],
      ["L.R. Date", formatDate(order?.createdAt)],
    ],
    [
      ["Order No.", getOrderNo(order)],
      ["Cases", String(rows.length || 0)],
      ["Transport", text(order?.transportName || "SCORPION EXPRESS")],
      ["Total Weight", text(order?.totalWeight || `${fmt0(totalQty)} KGS`)],
    ],
    [
      ["Issue Date and Time", formatDateTime(order?.createdAt)],
      ["Removal Date and Time", formatDateTime(order?.createdAt)],
      ["Delivery", text(order?.deliveryType || "DOOR")],
      ["Place Of Supply", `${buyer.state || "-"}`],
    ],
  ];

  const colW = fullW / 4;
  const rowH = metaH / 3;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const cellX = margin + c * colW;
      const cellY = y + r * rowH;
      const pair = metaRows[r][c];
      drawCell(doc, cellX, cellY, colW, rowH, "");
      doc.font("Helvetica-Bold").fontSize(6.5).text(pair[0], cellX + 2, cellY + 2, { width: colW - 4, lineBreak: false });
      doc.font("Helvetica").fontSize(6.5).text(String(pair[1] || "-"), cellX + 2, cellY + 10, {
        width: colW - 4,
        lineBreak: false,
        ellipsis: true,
      });
    }
  }

  y += metaH;

  const columns = [
    { key: "st", label: "St", w: 18, align: "center" },
    { key: "hsn", label: "HSN", w: 42, align: "center" },
    { key: "productName", label: "PRODUCT Name", w: 154, align: "left" },
    { key: "pUnit", label: "P UNIT", w: 40, align: "center" },
    { key: "batchNo", label: "Batch No.", w: 42, align: "center" },
    { key: "mfg", label: "Mfg", w: 30, align: "center" },
    { key: "exp", label: "Exp", w: 30, align: "center" },
    { key: "mrp", label: "M.R.P.", w: 38, align: "right" },
    { key: "ptr", label: "Ptr", w: 38, align: "right" },
    { key: "caseWeight", label: "Weight", w: 44, align: "center" },
    { key: "cases", label: "Cases", w: 34, align: "right" },
    { key: "qty", label: "Quantity", w: 38, align: "right" },
    { key: "unit", label: "Unit", w: 32, align: "center" },
    { key: "rate", label: "Rate", w: 40, align: "right" },
    { key: "tGst", label: "TGST", w: 36, align: "right" },
    { key: "value", label: "Value", w: 42, align: "right" },
    { key: "amount", label: "Amount", w: 58, align: "right" },
  ];

  const tableW = columns.reduce((s, c) => s + c.w, 0);
  const tableX = margin;
  const headerH = 18;
  const lineH = 16;
  const printableRows = rows.length ? rows : [];
  const minRows = 12;
  const rowCount = Math.max(minRows, printableRows.length);

  drawCell(doc, tableX, y, tableW, headerH, "");
  let cx = tableX;
  for (const col of columns) {
    drawCell(doc, cx, y, col.w, headerH, col.label, { font: "Helvetica-Bold", size: 7, align: "center" });
    cx += col.w;
  }

  let tableY = y + headerH;
  for (let i = 0; i < rowCount; i += 1) {
    const row = printableRows[i] || {};
    let rx = tableX;
    for (const col of columns) {
      let value = row[col.key] ?? "";
      if (["mrp", "ptr", "rate", "value", "amount"].includes(col.key) && value !== "") value = fmt3(value);
      if (col.key === "tGst" && value !== "") value = fmt3(value);
      drawCell(doc, rx, tableY, col.w, lineH, value, { size: 6.6, align: col.align || "left" });
      rx += col.w;
    }
    tableY += lineH;
  }

  y = tableY;

  const sumH = 58;
  drawCell(doc, margin, y, fullW, sumH, "");

  const leftSumW = Math.round(fullW * 0.58);
  const middleSumW = Math.round(fullW * 0.22);
  const rightSumW = fullW - leftSumW - middleSumW;

  drawCell(doc, margin, y, leftSumW, sumH, "");
  drawCell(doc, margin + leftSumW, y, middleSumW, sumH, "");
  drawCell(doc, margin + leftSumW + middleSumW, y, rightSumW, sumH, "");

  doc.font("Helvetica-Bold").fontSize(7).text("CLASS", margin + 3, y + 3);
  doc.text("TOTAL", margin + 70, y + 3);
  doc.text("SCHEME", margin + 115, y + 3);
  doc.text("DISCOUNT", margin + 167, y + 3);
  doc.text("IGST", margin + 220, y + 3);

  const gstRows = ["IGST 5.00%", "IGST 12.00%", "IGST 18.00%", "IGST 28.00%"];
  gstRows.forEach((label, idx) => {
    const by = y + 14 + idx * 10;
    doc.font("Helvetica").fontSize(6.5).text(label, margin + 3, by);
    doc.text("0.000", margin + 70, by);
    doc.text("0.000", margin + 115, by);
    doc.text("0.000", margin + 167, by);
    doc.text("0.000", margin + 220, by);
  });

  doc.font("Helvetica-Bold").fontSize(7).text("TOTAL", margin + 3, y + sumH - 10);
  doc.text("0.00", margin + 70, y + sumH - 10);

  doc.font("Helvetica").fontSize(7).text(`Total Items :-      ${rows.length || 0}`, margin + leftSumW + 6, y + 10);
  doc.text(`Total Qty    :-      ${totalQty}`, margin + leftSumW + 6, y + 22);

  doc.font("Helvetica-Bold").fontSize(8).text("TOTAL", margin + leftSumW + middleSumW + 6, y + 4);
  doc.font("Helvetica-Bold").fontSize(9).text(fmt3(totalAmount), margin + leftSumW + middleSumW + rightSumW - 6 - 50, y + 4, {
    width: 50,
    align: "right",
  });
  doc.font("Helvetica").fontSize(7).text("DIS AMT.", margin + leftSumW + middleSumW + 6, y + 18);
  doc.text("0.00", margin + leftSumW + middleSumW + rightSumW - 56, y + 18, { width: 50, align: "right" });
  doc.text("TGST PAYBLE", margin + leftSumW + middleSumW + 6, y + 30);
  doc.text("0.000%", margin + leftSumW + middleSumW + 70, y + 30);
  doc.text("0.00", margin + leftSumW + middleSumW + rightSumW - 56, y + 30, { width: 50, align: "right" });
  doc.text("TCS @", margin + leftSumW + middleSumW + 6, y + 42);
  doc.text("0.000", margin + leftSumW + middleSumW + rightSumW - 56, y + 42, { width: 50, align: "right" });

  y += sumH;

  const wordsH = 14;
  drawCell(doc, margin, y, fullW, wordsH, "");
  doc.font("Helvetica").fontSize(6.5).text(`Rs. ${amountToWords(totalAmount)}`, margin + 3, y + 3, {
    width: fullW - 6,
    lineBreak: false,
    ellipsis: true,
  });

  y += wordsH;

  const bottomH = pageH - margin - y;
  const leftBottomW = Math.round(fullW * 0.78);
  const rightBottomW = fullW - leftBottomW;

  drawCell(doc, margin, y, leftBottomW, bottomH, "");
  drawCell(doc, margin + leftBottomW, y, rightBottomW, bottomH, "");

  const bankBlockH = Math.round(bottomH * 0.58);
  drawCell(doc, margin, y, leftBottomW / 2, bankBlockH, "");
  drawCell(doc, margin + leftBottomW / 2, y, leftBottomW / 2, bankBlockH, "");

  doc.font("Helvetica-Bold").fontSize(8).text("OUR BANK DETAIL :-", margin + 4, y + 4);
  doc.font("Helvetica").fontSize(7).text(`Bank Name : ${BANK.bankName}`, margin + 4, y + 16);
  doc.text(`Branch Name : ${BANK.branch}`, margin + 4, y + 26, { width: leftBottomW / 2 - 8 });
  doc.text(`Account No. : ${BANK.accountNo}`, margin + 4, y + 38);
  doc.text(`IFSC Code : ${BANK.ifsc}`, margin + 4, y + 50);

  doc.font("Helvetica-Bold").fontSize(8).text(`FOR  ${SELLER.name}`, margin + leftBottomW / 2 + 4, y + 4);
  doc.font("Helvetica-Bold").fontSize(8).text("Authorised Signatory", margin + leftBottomW / 2 + 20, y + bankBlockH - 20);

  const termsY = y + bankBlockH;
  const termsH = bottomH - bankBlockH;
  drawCell(doc, margin, termsY, leftBottomW, termsH, "");
  doc.font("Helvetica-Bold").fontSize(8).text("Terms & Conditions", margin + 4, termsY + 4);
  doc.font("Helvetica").fontSize(7);
  TERMS.forEach((line, idx) => {
    doc.text(line, margin + 4, termsY + 16 + idx * 10, { width: leftBottomW - 8 });
  });

  doc.font("Helvetica").fontSize(7).text("MARG ERP NANO TO CHANGE GPS-5601 | STOCK,ACCOUNTS,GST,E-Way bill SOFTWARE PURCHASED FROM: 9876072888, 8477063701, 8470063703", margin + 4, pageH - margin - 8, {
    width: fullW - 8,
    align: "center",
    lineBreak: false,
    ellipsis: true,
  });

  doc.font("Helvetica").fontSize(9).text("Grand Total", margin + leftBottomW + 8, y + bottomH / 2 - 16, {
    width: rightBottomW - 16,
    align: "center",
  });
  doc.font("Helvetica-Bold").fontSize(16).text(fmt2(totalAmount), margin + leftBottomW + 8, y + bottomH / 2 + 4, {
    width: rightBottomW - 16,
    align: "center",
  });

  doc.end();
  const blob = await waitForBlob(stream);
  triggerBrowserDownload(blob, `${getInvoiceNo(order)}.pdf`);
}

function fmt0(value) {
  return Math.round(toNum(value)).toString();
}
