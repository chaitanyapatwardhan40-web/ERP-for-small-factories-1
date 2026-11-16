/**
 * The golden dataset: one kitting shop, three programs, about 120 sales
 * orders in every state, with the books posted from every event. Used by
 * demos, previews and tests. Run with `npm run db:seed`.
 *
 * Everything goes through the same services the app uses, so the ledger,
 * inventory and job costs are consistent by construction.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { and, eq } from "drizzle-orm";
import { getDb } from "./index";
import {
  assets,
  bomLines,
  bomRevisions,
  customers,
  employees,
  gauges,
  inspectionPlans,
  items,
  leads,
  locations,
  maintenanceTasks,
  routingOperations,
  routings,
  users,
  vendors,
  workCenters,
  workOrderOperations,
} from "./schema";
import { createOrg, registerUser } from "@/modules/platform/service";
import { moveStock } from "@/modules/inventory/service";
import { postJournal } from "@/modules/books/service";
import { accounts } from "./schema";
import { createPurchaseOrder, createBillFromPo, payBill, receivePurchaseOrder, setPoStatus } from "@/modules/purchasing/service";
import { acceptQuote, confirmOrder, createOrder, createQuote } from "@/modules/sales/service";
import { completeWorkOrder, createWorkOrdersForOrder, issueAllMaterials, recordLabor, releaseWorkOrder } from "@/modules/production/service";
import { createInvoiceFromShipment, recordCustomerPayment, shipOrderInFull } from "@/modules/shipping/service";
import { refreshStandardCost } from "@/modules/items/service";
import { addDays, today } from "@/lib/money";

// Deterministic pseudo-random so the demo looks the same every time.
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

async function main() {
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, "owner@kitwise.demo"));
  if (existing) {
    console.log("Demo shop already seeded. Delete ./.data to start over.");
    return;
  }
  console.log("Seeding Kitwise demo shop…");
  const owner = await registerUser(db, { email: "owner@kitwise.demo", name: "Sam Owner", password: "kitwise-demo" });
  const office = await registerUser(db, { email: "office@kitwise.demo", name: "Dana Office", password: "kitwise-demo" });
  const floor = await registerUser(db, { email: "floor@kitwise.demo", name: "Pat Floor", password: "kitwise-demo" });
  const org = await createOrg(db, { name: "Northline Kitting & Assembly", ownerUserId: owner.id, overheadPct: 25, taxRatePct: 0 });
  const { memberships } = await import("./schema");
  await db.insert(memberships).values([
    { orgId: org.id, userId: office.id, role: "office" },
    { orgId: org.id, userId: floor.id, role: "shop" },
  ]);
  const actor = { orgId: org.id, userId: owner.id };
  const [main] = await db.select().from(locations).where(and(eq(locations.orgId, org.id), eq(locations.code, "MAIN")));

  // Opening cash.
  const [cash] = await db.select().from(accounts).where(and(eq(accounts.orgId, org.id), eq(accounts.subtype, "cash")));
  const [equity] = await db.select().from(accounts).where(and(eq(accounts.orgId, org.id), eq(accounts.subtype, "owner_equity")));
  await postJournal(db, { orgId: org.id, date: addDays(today(), -150), memo: "Opening cash balance", lines: [{ accountId: cash.id, debit: 85000, credit: 0 }, { accountId: equity.id, debit: 0, credit: 85000 }] });

  // Work centers.
  await db.delete(workCenters).where(eq(workCenters.orgId, org.id));
  const wcDefs: [string, string, number, number][] = [
    ["CUT", "Saw & shear", 55, 8],
    ["CNC1", "CNC mill (Haas VF-2)", 85, 16],
    ["LATHE", "CNC lathe", 80, 8],
    ["WELD", "Welding", 70, 8],
    ["ASM", "Assembly bench", 45, 16],
    ["PACK", "Kitting & pack", 40, 8],
  ];
  const wcs: Record<string, string> = {};
  for (const [code, name, rate, cap] of wcDefs) {
    const [w] = await db.insert(workCenters).values({ orgId: org.id, code, name, hourlyRate: rate, capacityHoursPerDay: cap }).returning();
    wcs[code] = w.id;
  }

  // People.
  const empDefs: [string, string, number, string[]][] = [
    ["Pat Nguyen", "PAT", 32, ["CNC mill", "deburr"]],
    ["Luis Ortega", "LUI", 30, ["lathe", "saw"]],
    ["Grace Kim", "GRA", 28, ["assembly", "kitting", "final inspection"]],
    ["Omar Haddad", "OMA", 36, ["welding", "fit-up"]],
    ["Jess Taylor", "JES", 26, ["kitting", "packing", "shipping"]],
    ["Ravi Mehta", "RAV", 34, ["CNC mill", "programming"]],
  ];
  const emps: string[] = [];
  for (const [name, badge, rate, skills] of empDefs) {
    const [e] = await db.insert(employees).values({ orgId: org.id, name, badge, hourlyRate: rate, skills, userId: name === "Pat Nguyen" ? floor.id : null }).returning();
    emps.push(e.id);
  }

  // Vendors.
  const vendorDefs: [string, number, number][] = [
    ["Metro Metals Supply", 30, 5],
    ["Precision Fasteners Inc", 30, 3],
    ["Allied Electronics", 45, 10],
    ["Coastal Plastics", 30, 14],
    ["Summit Anodizing", 30, 7],
    ["TriState Powder Coat", 30, 7],
    ["Northwind Cable & Harness", 30, 21],
    ["Keystone Packaging", 15, 4],
    ["Ridge Tool & Cutter", 30, 7],
    ["Harbor Bearings", 30, 10],
    ["Lakeside Springs", 30, 14],
    ["Delta Labels", 15, 5],
    ["Omni Adhesives", 30, 7],
    ["Pioneer Sheet Metal", 30, 12],
    ["BlueRock Castings", 45, 28],
    ["Apex Heat Treat", 30, 6],
    ["Clearwater Gaskets", 30, 10],
    ["Vertex Sensors", 45, 21],
    ["City Utilities", 20, 1],
    ["Main Street Properties", 10, 1],
  ];
  const vend: Record<string, string> = {};
  let vn = 1;
  for (const [name, terms, lead] of vendorDefs) {
    const [v] = await db.insert(vendors).values({ orgId: org.id, code: `V-${String(vn++).padStart(3, "0")}`, name, termsDays: terms, leadTimeDays: lead, email: `orders@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`, address: { city: pick(["Toledo", "Akron", "Dayton", "Erie", "Fort Wayne"]), state: "OH", country: "US" } }).returning();
    vend[name] = v.id;
  }

  // Customers.
  const custDefs: [string, string, number][] = [
    ["Acme Robotics", "Columbus, OH", 30],
    ["Helix Medical Devices", "Cleveland, OH", 45],
    ["Orion Defense Systems", "Dayton, OH", 60],
    ["Greenfield Agri-Tech", "Fort Wayne, IN", 30],
    ["Summit Outdoor Power", "Pittsburgh, PA", 30],
    ["Lumen Lighting Co", "Detroit, MI", 30],
    ["Boreal Marine", "Erie, PA", 45],
    ["Cascade Vending", "Louisville, KY", 30],
    ["Ironclad Fitness Equipment", "Indianapolis, IN", 30],
    ["Pinnacle HVAC Controls", "Akron, OH", 30],
  ];
  const custIds: string[] = [];
  let cn = 1;
  for (const [name, loc, terms] of custDefs) {
    const [city, state] = loc.split(", ");
    const [c] = await db.insert(customers).values({ orgId: org.id, code: `C-${String(cn++).padStart(3, "0")}`, name, termsDays: terms, email: `purchasing@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`, phone: `(${between(216, 937)}) 555-0${between(100, 199)}`, billingAddress: { line1: `${between(100, 9999)} Industrial Pkwy`, city, state, postalCode: String(between(43000, 46999)), country: "US" } }).returning();
    custIds.push(c.id);
  }

  // Components (buy items).
  const buyDefs: [string, string, number, string, number, number, string][] = [
    ["AL-PLATE-6x6", "Aluminum plate 6061 6x6x0.25", 11.4, "Metro Metals Supply", 40, 80, "ea"],
    ["AL-BAR-1x1", "Aluminum bar 6061 1x1 (per ft)", 3.1, "Metro Metals Supply", 100, 200, "ft"],
    ["STL-TUBE-2", "Steel tube 2x2x0.12 (per ft)", 4.2, "Metro Metals Supply", 60, 120, "ft"],
    ["SS-SHEET-16GA", "Stainless sheet 16ga (sq ft)", 9.8, "Pioneer Sheet Metal", 30, 60, "sqft"],
    ["SCR-M4-12", "Screw M4x12 SHCS", 0.08, "Precision Fasteners Inc", 2000, 5000, "ea"],
    ["SCR-M6-20", "Screw M6x20 SHCS", 0.14, "Precision Fasteners Inc", 1000, 2500, "ea"],
    ["NUT-M6", "Nut M6 nyloc", 0.06, "Precision Fasteners Inc", 1000, 2500, "ea"],
    ["WSH-M6", "Washer M6 flat", 0.03, "Precision Fasteners Inc", 1000, 2500, "ea"],
    ["RIVET-316", "Rivet 3/16 aluminum", 0.05, "Precision Fasteners Inc", 2000, 5000, "ea"],
    ["BRG-6204", "Bearing 6204-2RS", 4.6, "Harbor Bearings", 40, 100, "ea"],
    ["SPR-COMP-12", "Compression spring 12mm", 0.9, "Lakeside Springs", 100, 300, "ea"],
    ["GSK-NBR-80", "Gasket NBR 80mm", 1.2, "Clearwater Gaskets", 100, 300, "ea"],
    ["PCB-CTRL-A", "Controller PCB rev A", 42, "Allied Electronics", 20, 50, "ea"],
    ["SENS-TEMP-K", "Temp sensor type K", 18.5, "Vertex Sensors", 20, 50, "ea"],
    ["SENS-PRES-5", "Pressure sensor 5 bar", 27, "Vertex Sensors", 10, 30, "ea"],
    ["CABLE-4C-2M", "Cable 4-conductor 2m", 6.3, "Northwind Cable & Harness", 50, 100, "ea"],
    ["CONN-M12-4", "Connector M12 4-pin", 3.9, "Allied Electronics", 100, 200, "ea"],
    ["LED-AMBER", "LED indicator amber 24V", 2.2, "Allied Electronics", 50, 150, "ea"],
    ["ENC-ABS-S", "Enclosure ABS small", 7.7, "Coastal Plastics", 30, 100, "ea"],
    ["ENC-ABS-L", "Enclosure ABS large", 13.9, "Coastal Plastics", 20, 60, "ea"],
    ["FOAM-INS-A", "Foam insert A", 1.6, "Keystone Packaging", 100, 300, "ea"],
    ["BOX-12x9x4", "Shipping box 12x9x4", 0.95, "Keystone Packaging", 200, 500, "ea"],
    ["LBL-KIT-4x2", "Kit label 4x2", 0.07, "Delta Labels", 500, 2000, "ea"],
    ["ADH-EPOXY-50", "Epoxy 50ml cartridge", 8.4, "Omni Adhesives", 10, 30, "ea"],
    ["CAST-HSG-7", "Housing casting #7", 31, "BlueRock Castings", 10, 40, "ea"],
  ];
  const item: Record<string, string> = {};
  for (const [sku, name, cost, vendorName, rp, rq, uom] of buyDefs) {
    const [it] = await db.insert(items).values({ orgId: org.id, sku, name, type: "buy", uom, standardCost: cost, lastCost: cost, reorderPoint: rp, reorderQty: rq, leadTimeDays: 7, preferredVendorId: vend[vendorName] }).returning();
    item[sku] = it.id;
  }

  // Make items: sub-assemblies and kits.
  const makeDefs: [string, string, number, [string, number][], [string, string, number, number][]][] = [
    // sku, name, price, bom [component, qty], routing [name, wc, setupH, runMin/unit]
    ["SA-BRACKET-L", "Bracket, machined L", 38, [["AL-PLATE-6x6", 1], ["SCR-M4-12", 4]], [["Saw blank", "CUT", 0.25, 2], ["Mill profile", "CNC1", 0.75, 9], ["Deburr", "ASM", 0, 3]]],
    ["SA-SHAFT-200", "Shaft 200mm turned", 44, [["AL-BAR-1x1", 0.8], ["BRG-6204", 2]], [["Turn", "LATHE", 0.5, 12], ["Press bearings", "ASM", 0.1, 4]]],
    ["SA-FRAME-T", "Frame, welded tube", 96, [["STL-TUBE-2", 6], ["RIVET-316", 8]], [["Cut tube", "CUT", 0.2, 6], ["Weld frame", "WELD", 0.5, 25], ["Grind", "WELD", 0, 8]]],
    ["SA-PANEL-SS", "Panel, stainless formed", 52, [["SS-SHEET-16GA", 1.5], ["RIVET-316", 6]], [["Shear", "CUT", 0.2, 3], ["Form", "CNC1", 0.5, 6]]],
    ["SA-CTRL-BOX", "Control box assembly", 165, [["ENC-ABS-L", 1], ["PCB-CTRL-A", 1], ["CONN-M12-4", 2], ["LED-AMBER", 2], ["SCR-M4-12", 8], ["GSK-NBR-80", 1]], [["Assemble electronics", "ASM", 0.2, 22], ["Function test", "ASM", 0.1, 8]]],
    ["SA-SENSOR-POD", "Sensor pod", 88, [["ENC-ABS-S", 1], ["SENS-TEMP-K", 1], ["CABLE-4C-2M", 1], ["ADH-EPOXY-50", 0.1], ["SCR-M4-12", 4]], [["Pot sensor", "ASM", 0.1, 12], ["Cure & test", "ASM", 0, 5]]],
    ["SA-HOUSING-7", "Housing #7 machined", 74, [["CAST-HSG-7", 1], ["GSK-NBR-80", 1]], [["Mill faces", "CNC1", 0.6, 14], ["Deburr & wash", "ASM", 0, 4]]],
    ["SA-SPRING-PACK", "Spring pack", 9, [["SPR-COMP-12", 4], ["WSH-M6", 4], ["NUT-M6", 4]], [["Bag & label", "PACK", 0.05, 2]]],
    ["KIT-ROBOT-ARM", "Robot arm field kit", 420, [["SA-BRACKET-L", 2], ["SA-SHAFT-200", 1], ["SA-SPRING-PACK", 1], ["SCR-M6-20", 12], ["FOAM-INS-A", 1], ["BOX-12x9x4", 1], ["LBL-KIT-4x2", 1]], [["Pick components", "PACK", 0.1, 6], ["Kit & label", "PACK", 0, 8], ["Final check", "PACK", 0, 3]]],
    ["KIT-SENSOR-SET", "Sensor set kit", 310, [["SA-SENSOR-POD", 2], ["SA-CTRL-BOX", 1], ["CABLE-4C-2M", 2], ["FOAM-INS-A", 1], ["BOX-12x9x4", 1], ["LBL-KIT-4x2", 1]], [["Pick components", "PACK", 0.1, 5], ["Kit & label", "PACK", 0, 6], ["Final check", "PACK", 0, 4]]],
    ["KIT-FRAME-MOUNT", "Frame mount kit", 265, [["SA-FRAME-T", 1], ["SA-PANEL-SS", 2], ["SCR-M6-20", 16], ["NUT-M6", 16], ["WSH-M6", 16], ["LBL-KIT-4x2", 1]], [["Pick components", "PACK", 0.1, 8], ["Fit panels", "ASM", 0.2, 15], ["Kit & label", "PACK", 0, 6]]],
    ["KIT-HOUSING-SVC", "Housing service kit", 190, [["SA-HOUSING-7", 1], ["GSK-NBR-80", 2], ["SA-SPRING-PACK", 1], ["BOX-12x9x4", 1], ["LBL-KIT-4x2", 1]], [["Pick components", "PACK", 0.1, 4], ["Kit & label", "PACK", 0, 5]]],
    ["KIT-CTRL-UPGRADE", "Controller upgrade kit", 520, [["SA-CTRL-BOX", 2], ["SA-SENSOR-POD", 1], ["SA-BRACKET-L", 2], ["SCR-M6-20", 8], ["FOAM-INS-A", 2], ["BOX-12x9x4", 1], ["LBL-KIT-4x2", 1]], [["Pick components", "PACK", 0.1, 8], ["Kit & label", "PACK", 0, 8], ["Final check", "PACK", 0, 5]]],
    ["KIT-PRESSURE-MON", "Pressure monitor kit", 240, [["SENS-PRES-5", 1], ["SA-CTRL-BOX", 1], ["CABLE-4C-2M", 1], ["SA-BRACKET-L", 1], ["BOX-12x9x4", 1], ["LBL-KIT-4x2", 1]], [["Pick components", "PACK", 0.1, 5], ["Kit & label", "PACK", 0, 6]]],
    ["KIT-SPARES-A", "Spares kit A", 145, [["BRG-6204", 4], ["SPR-COMP-12", 8], ["GSK-NBR-80", 4], ["SCR-M6-20", 20], ["SCR-M4-12", 40], ["BOX-12x9x4", 1], ["LBL-KIT-4x2", 1]], [["Pick components", "PACK", 0.1, 6], ["Kit & label", "PACK", 0, 5]]],
  ];
  for (const [sku, name, price] of makeDefs) {
    const [it] = await db.insert(items).values({ orgId: org.id, sku, name, type: "make", uom: "ea", salesPrice: price, leadTimeDays: 10, trackLots: sku.startsWith("KIT") }).returning();
    item[sku] = it.id;
  }
  for (const [sku, , , bom, routing] of makeDefs) {
    const [rev] = await db.insert(bomRevisions).values({ orgId: org.id, itemId: item[sku], rev: "A", status: "active" }).returning();
    await db.insert(bomLines).values(bom.map(([c, q], i) => ({ orgId: org.id, bomRevisionId: rev.id, componentItemId: item[c], qty: q, scrapPct: c.startsWith("AL-BAR") || c.startsWith("STL-TUBE") || c.startsWith("SS-SHEET") ? 5 : 0, position: (i + 1) * 10 })));
    const [rt] = await db.insert(routings).values({ orgId: org.id, itemId: item[sku], rev: "A", status: "active" }).returning();
    await db.insert(routingOperations).values(routing.map(([opName, wc, setup, run], i) => ({ orgId: org.id, routingId: rt.id, seq: (i + 1) * 10, name: opName, workCenterId: wcs[wc], setupHours: setup, runHoursPerUnit: run / 60 })));
  }
  for (const [sku] of makeDefs) await refreshStandardCost(db, org.id, item[sku], { overheadPct: 25 });

  // Opening stock: components on the shelf, valued at cost, posted to Inventory / Owner's equity.
  for (const [sku, , cost, , rp, rq] of buyDefs) {
    const qty = rp + Math.round(rq * (0.4 + rnd()));
    await moveStock(db, { orgId: org.id, userId: owner.id, itemId: item[sku], locationId: main.id, qty, unitCost: cost, type: "receipt", refType: "opening", memo: "Opening stock", date: addDays(today(), -150), glEvent: "inventory.opening" });
  }

  // Quality plans, gauges, machines.
  await db.insert(inspectionPlans).values([
    { orgId: org.id, name: "Incoming: machined castings", stage: "incoming", itemId: item["CAST-HSG-7"], sampleSize: 3, checklist: [{ name: "Bore Ø 40.00 ±0.05", type: "measurement", unit: "mm", min: 39.95, max: 40.05 }, { name: "No porosity on sealing face", type: "visual" }, { name: "Cert of conformance received", type: "document" }] },
    { orgId: org.id, name: "In-process: bracket", stage: "in_process", itemId: item["SA-BRACKET-L"], sampleSize: 1, checklist: [{ name: "Hole position ±0.1", type: "measurement", unit: "mm", min: -0.1, max: 0.1 }, { name: "Deburred", type: "visual" }] },
    { orgId: org.id, name: "Final: kits", stage: "final", itemId: null, sampleSize: 1, checklist: [{ name: "All components present per pick list", type: "visual" }, { name: "Label matches order", type: "visual" }, { name: "Box sealed, no damage", type: "visual" }] },
  ]);
  await db.insert(gauges).values([
    { orgId: org.id, name: "Mitutoyo 0-25mm micrometer", serial: "MM-0421", calibrationIntervalDays: 365, lastCalibratedAt: addDays(today(), -300), nextDueAt: addDays(today(), 65) },
    { orgId: org.id, name: "Digital caliper 150mm", serial: "DC-1182", calibrationIntervalDays: 180, lastCalibratedAt: addDays(today(), -190), nextDueAt: addDays(today(), -10) },
    { orgId: org.id, name: "Bore gauge 35-50mm", serial: "BG-0073", calibrationIntervalDays: 365, lastCalibratedAt: addDays(today(), -120), nextDueAt: addDays(today(), 245) },
  ]);
  const [haas] = await db.insert(assets).values({ orgId: org.id, name: "Haas VF-2 #1", workCenterId: wcs.CNC1, serial: "1183421", purchasedAt: "2021-03-15" }).returning();
  const [lathe] = await db.insert(assets).values({ orgId: org.id, name: "Doosan Lynx 2100", workCenterId: wcs.LATHE, serial: "ML2100-0891", purchasedAt: "2019-08-01" }).returning();
  await db.insert(assets).values({ orgId: org.id, name: "Miller Syncrowave 250", workCenterId: wcs.WELD, serial: "MC440122", purchasedAt: "2017-05-20" });
  await db.insert(maintenanceTasks).values([
    { orgId: org.id, assetId: haas.id, name: "Change way lube, check coolant concentration", intervalDays: 30, lastDoneAt: addDays(today(), -25), nextDueAt: addDays(today(), 5), instructions: "Vactra #2; 8-10% coolant" },
    { orgId: org.id, assetId: haas.id, name: "Spindle warm-up and tram check", intervalDays: 90, lastDoneAt: addDays(today(), -95), nextDueAt: addDays(today(), -5) },
    { orgId: org.id, assetId: lathe.id, name: "Chuck clean and grease", intervalDays: 60, lastDoneAt: addDays(today(), -20), nextDueAt: addDays(today(), 40) },
  ]);

  // Leads.
  await db.insert(leads).values([
    { orgId: org.id, company: "Redwood Conveyor Systems", contactName: "Maya Chen", email: "maya@redwoodconveyor.example.com", source: "trade_show", stage: "quoting", estimatedValue: 18000, nextAction: "Send quote for 40 mount kits", nextActionAt: new Date(Date.now() + 2 * 86_400_000), ownerId: office.id },
    { orgId: org.id, company: "Harborline Pumps", contactName: "Dev Patel", email: "dev@harborlinepumps.example.com", source: "website", stage: "contacted", estimatedValue: 9500, nextAction: "Call back about housing service kits", nextActionAt: new Date(Date.now() + 86_400_000), ownerId: office.id },
    { orgId: org.id, company: "Alder Lab Automation", contactName: "Sofia Rossi", source: "referral", stage: "new", estimatedValue: 25000, nextAction: "Intro call", ownerId: owner.id },
    { orgId: org.id, company: "Crestview Drones", contactName: "Ben Walsh", source: "cold", stage: "lost", estimatedValue: 6000, notes: "Went with an offshore kit supplier on price." },
  ]);

  // Buy: a few POs in different states.
  const po1 = await createPurchaseOrder(db, actor, { vendorId: vend["Metro Metals Supply"], orderDate: addDays(today(), -20), lines: [{ itemId: item["AL-PLATE-6x6"], qty: 80, unitCost: 11.4 }, { itemId: item["STL-TUBE-2"], qty: 120, unitCost: 4.2 }] });
  await setPoStatus(db, actor, po1.id, "sent");
  await setPoStatus(db, actor, po1.id, "confirmed", { confirmedDate: addDays(today(), -14), vendorRef: "MM-88213" });
  const po1Lines = await db.query.purchaseOrderLines.findMany({ where: (t, { eq }) => eq(t.poId, po1.id) });
  await receivePurchaseOrder(db, actor, { poId: po1.id, receivedAt: new Date(Date.now() - 13 * 86_400_000), packingSlip: "PS-55102", lines: po1Lines.map((l) => ({ poLineId: l.id, qty: Number(l.qty), locationId: main.id, lotNumber: "H24-" + between(100, 999) })) });
  const bill1 = await createBillFromPo(db, actor, { poId: po1.id, billDate: addDays(today(), -12), vendorRef: "INV-20331" });
  await payBill(db, actor, { billId: bill1.id, amount: Number(bill1.total), paidAt: addDays(today(), -2), method: "ach", reference: "ACH 4471" });

  const po2 = await createPurchaseOrder(db, actor, { vendorId: vend["Allied Electronics"], orderDate: addDays(today(), -9), lines: [{ itemId: item["PCB-CTRL-A"], qty: 50, unitCost: 42 }, { itemId: item["CONN-M12-4"], qty: 200, unitCost: 3.9 }] });
  await setPoStatus(db, actor, po2.id, "sent");
  await setPoStatus(db, actor, po2.id, "confirmed", { confirmedDate: addDays(today(), 3) });
  const po3 = await createPurchaseOrder(db, actor, { vendorId: vend["BlueRock Castings"], orderDate: addDays(today(), -30), lines: [{ itemId: item["CAST-HSG-7"], qty: 40, unitCost: 31 }] });
  await setPoStatus(db, actor, po3.id, "sent");
  const po3Lines = await db.query.purchaseOrderLines.findMany({ where: (t, { eq }) => eq(t.poId, po3.id) });
  await receivePurchaseOrder(db, actor, { poId: po3.id, receivedAt: new Date(Date.now() - 4 * 86_400_000), lines: [{ poLineId: po3Lines[0].id, qty: 25, locationId: main.id, lotNumber: "BR-7781" }] });
  await createBillFromPo(db, actor, { poId: po3.id, billDate: addDays(today(), -3), vendorRef: "BRC-1902" });
  const po4 = await createPurchaseOrder(db, actor, { vendorId: vend["Precision Fasteners Inc"], orderDate: addDays(today(), -2), lines: [{ itemId: item["SCR-M6-20"], qty: 2500, unitCost: 0.14 }, { itemId: item["NUT-M6"], qty: 2500, unitCost: 0.06 }] });
  void po4;
  // Expense bills.
  const { createExpenseBill } = await import("@/modules/purchasing/service");
  const rent = await createExpenseBill(db, actor, { vendorId: vend["Main Street Properties"], billDate: addDays(today(), -15), description: "Monthly rent, Unit 4", amount: 6800 });
  await payBill(db, actor, { billId: rent.id, amount: 6800, paidAt: addDays(today(), -14), method: "check", reference: "1021" });
  await createExpenseBill(db, actor, { vendorId: vend["City Utilities"], billDate: addDays(today(), -6), description: "Electric and gas", amount: 1420 });

  // Sell: three kitting programs, one order per kit; mix of stages.
  const programs: [string, string, string[], number][] = [
    ["P-2026-ARM", "Acme Robotics", ["KIT-ROBOT-ARM", "KIT-SPARES-A"], 45],
    ["P-2026-SENSE", "Helix Medical Devices", ["KIT-SENSOR-SET", "KIT-PRESSURE-MON", "KIT-CTRL-UPGRADE"], 40],
    ["P-2026-MOUNT", "Orion Defense Systems", ["KIT-FRAME-MOUNT", "KIT-HOUSING-SVC"], 35],
  ];
  const custByName = Object.fromEntries(custDefs.map((c, i) => [c[0], custIds[i]]));
  let n = 0;
  const stats = { draft: 0, confirmed: 0, production: 0, shipped: 0, paid: 0 };
  for (const [program, customerName, kits, count] of programs) {
    for (let i = 0; i < count; i++) {
      n++;
      const kit = kits[i % kits.length];
      const [itemRow] = await db.select().from(items).where(eq(items.id, item[kit]));
      const qty = between(1, 6);
      const ageDays = Math.floor((i / count) * 110) + 2; // oldest first
      const orderDate = addDays(today(), -ageDays);
      const promised = addDays(orderDate, between(18, 30));
      const order = await createOrder(db, actor, { customerId: custByName[customerName], customerPo: `${customerName.split(" ")[0].toUpperCase()}-PO-${4400 + n}`, program, orderDate, promisedDate: promised, lines: [{ itemId: item[kit], qty, unitPrice: Number(itemRow.salesPrice) }] });
      // Stage by age: old = shipped and paid, mid = shipped / in production, new = confirmed / draft.
      const stage = ageDays > 60 ? "paid" : ageDays > 32 ? "shipped" : ageDays > 9 ? "production" : ageDays > 4 ? "confirmed" : "draft";
      if (stage === "draft") {
        stats.draft++;
        continue;
      }
      await confirmOrder(db, actor, order.id);
      if (stage === "confirmed") {
        stats.confirmed++;
        continue;
      }
      const [wo] = await createWorkOrdersForOrder(db, actor, order.id);
      await releaseWorkOrder(db, actor, wo.id);
      // Make the sub-assemblies this kit needs first (simplified: receive them as if completed earlier).
      const short = await issueAllMaterials(db, actor, wo.id, main.id);
      if (short.length) {
        // Top up sub-assemblies from a prior "run" so the demo keeps moving.
        for (const s of short) {
          const [sub] = await db.select().from(items).where(and(eq(items.orgId, org.id), eq(items.sku, s.sku)));
          await moveStock(db, { orgId: org.id, userId: owner.id, itemId: sub.id, locationId: main.id, qty: Math.ceil(s.needed) + 10, unitCost: Number(sub.standardCost), type: "receipt", refType: "opening", memo: "Opening WIP transfer", date: orderDate, glEvent: "inventory.opening" });
        }
        await issueAllMaterials(db, actor, wo.id, main.id);
      }
      const ops = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, wo.id));
      if (stage === "production") {
        // Partly done: labour on the first op only.
        await recordLabor(db, actor, { operationId: ops[0].id, employeeId: pick(emps), hours: Number((0.3 + rnd()).toFixed(2)), qtyGood: Math.ceil(qty / 2), operationComplete: false });
        stats.production++;
        continue;
      }
      for (const op of ops) {
        const planned = Number(op.plannedSetupHours) + Number(op.plannedRunHours);
        await recordLabor(db, actor, { operationId: op.id, employeeId: pick(emps), hours: Number((planned * (0.85 + rnd() * 0.4) + 0.05).toFixed(2)), qtyGood: qty, operationComplete: true });
      }
      await completeWorkOrder(db, actor, { workOrderId: wo.id, qtyGood: qty, qtyScrap: 0, locationId: main.id, overheadPct: 25 });
      // Most ship a few days early; one in six slips past the promise.
      const shipDate = rnd() < 0.17 ? addDays(promised, between(1, 6)) : addDays(promised, -between(0, 5));
      const sh = await shipOrderInFull(db, actor, order.id, main.id, { carrier: pick(["UPS", "FedEx", "Customer pickup"]), tracking: `1Z${between(100000, 999999)}`, shippedAt: new Date(`${shipDate}T15:00:00`) });
      const inv = await createInvoiceFromShipment(db, actor, { shipmentId: sh.id, issueDate: shipDate, taxRatePct: 0 });
      if (stage === "paid") {
        await recordCustomerPayment(db, actor, { invoiceId: inv.id, amount: Number(inv.total), paidAt: addDays(shipDate, between(20, 45)), method: pick(["ach", "check"]), reference: `CHK ${between(1000, 9999)}` });
        stats.paid++;
      } else stats.shipped++;
    }
  }

  // One quote in flight for a lead-turned-customer.
  const q = await createQuote(db, actor, { customerId: custByName["Greenfield Agri-Tech"], quoteDate: addDays(today(), -3), validUntil: addDays(today(), 27), customerRfq: "GAT-RFQ-118", lines: [{ itemId: item["KIT-FRAME-MOUNT"], description: "Frame mount kit, 40 off", qty: 40, materialCost: 120, laborCost: 48, overheadCost: 12, marginPct: 32, leadTimeDays: 21 }] });
  await db.update((await import("./schema")).quotes).set({ status: "sent" }).where(eq((await import("./schema")).quotes.id, q.id));
  const q2 = await createQuote(db, actor, { customerId: custByName["Summit Outdoor Power"], quoteDate: addDays(today(), -40), validUntil: addDays(today(), -10), customerRfq: "SOP-2211", lines: [{ itemId: item["KIT-SPARES-A"], description: "Spares kit A", qty: 25, materialCost: 70, laborCost: 10, overheadCost: 2.5, marginPct: 30 }] });
  const acceptedOrder = await acceptQuote(db, actor, q2.id, "SOP-PO-9018");
  await confirmOrder(db, actor, acceptedOrder.id);

  console.log(`Seeded ${n} program orders:`, stats);
  console.log("Sign in: owner@kitwise.demo / kitwise-demo (also office@ and floor@ with the same password)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
