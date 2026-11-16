/**
 * The implementer's brain, part 1: which spreadsheet is this, and which
 * column is which field. Heuristics first (free, instant); Claude refines
 * when ANTHROPIC_API_KEY is set.
 */

export type EntityKind = "customers" | "vendors" | "items" | "bom" | "work_centers" | "stock" | "employees";

export type FieldDef = { key: string; label: string; required?: boolean; aliases: string[] };

export const ENTITIES: Record<EntityKind, { label: string; fields: FieldDef[]; hint: string }> = {
  customers: {
    label: "Customers",
    hint: "One row per customer. Code is optional; we number them if missing.",
    fields: [
      { key: "code", label: "Code", aliases: ["code", "customer code", "cust no", "customer number", "id", "account"] },
      { key: "name", label: "Name", required: true, aliases: ["name", "customer", "customer name", "company", "company name", "client"] },
      { key: "email", label: "Email", aliases: ["email", "e-mail", "contact email"] },
      { key: "phone", label: "Phone", aliases: ["phone", "telephone", "tel", "phone number"] },
      { key: "termsDays", label: "Terms (days)", aliases: ["terms", "net", "payment terms", "terms days"] },
      { key: "line1", label: "Street", aliases: ["address", "street", "address 1", "address1", "line1"] },
      { key: "city", label: "City", aliases: ["city", "town"] },
      { key: "state", label: "State", aliases: ["state", "province", "st"] },
      { key: "postalCode", label: "Postal code", aliases: ["zip", "zip code", "postal", "postal code", "postcode"] },
      { key: "notes", label: "Notes", aliases: ["notes", "comments", "memo"] },
    ],
  },
  vendors: {
    label: "Vendors",
    hint: "One row per supplier.",
    fields: [
      { key: "code", label: "Code", aliases: ["code", "vendor code", "vendor no", "supplier code", "id"] },
      { key: "name", label: "Name", required: true, aliases: ["name", "vendor", "vendor name", "supplier", "supplier name", "company"] },
      { key: "email", label: "Email", aliases: ["email", "e-mail"] },
      { key: "phone", label: "Phone", aliases: ["phone", "telephone", "tel"] },
      { key: "termsDays", label: "Terms (days)", aliases: ["terms", "net", "payment terms"] },
      { key: "leadTimeDays", label: "Lead time (days)", aliases: ["lead time", "leadtime", "lead", "lt days", "lead time days"] },
      { key: "line1", label: "Street", aliases: ["address", "street", "address 1"] },
      { key: "city", label: "City", aliases: ["city"] },
      { key: "state", label: "State", aliases: ["state", "province"] },
      { key: "postalCode", label: "Postal code", aliases: ["zip", "zip code", "postal code"] },
    ],
  },
  items: {
    label: "Items / parts",
    hint: "One row per part or assembly. Type make/buy is inferred from the words 'make', 'assy', 'kit' when there is no type column.",
    fields: [
      { key: "sku", label: "SKU / part number", required: true, aliases: ["sku", "part", "part number", "part no", "part #", "pn", "item", "item number", "item no", "item code", "number", "p/n"] },
      { key: "name", label: "Name", required: true, aliases: ["name", "description", "desc", "item name", "part name", "title"] },
      { key: "type", label: "Type (make/buy)", aliases: ["type", "make/buy", "make or buy", "source", "procurement", "item type"] },
      { key: "uom", label: "Unit", aliases: ["uom", "unit", "units", "u/m", "unit of measure"] },
      { key: "standardCost", label: "Cost", aliases: ["cost", "unit cost", "std cost", "standard cost", "price paid", "purchase price", "last cost"] },
      { key: "salesPrice", label: "Sales price", aliases: ["price", "sell price", "sales price", "list price", "unit price"] },
      { key: "reorderPoint", label: "Reorder point", aliases: ["reorder point", "min", "minimum", "min qty", "reorder"] },
      { key: "reorderQty", label: "Reorder qty", aliases: ["reorder qty", "order qty", "eoq", "max", "lot size"] },
      { key: "leadTimeDays", label: "Lead time (days)", aliases: ["lead time", "leadtime", "lt"] },
      { key: "vendor", label: "Preferred vendor", aliases: ["vendor", "supplier", "preferred vendor", "source vendor"] },
      { key: "drawingNumber", label: "Drawing", aliases: ["drawing", "drawing number", "dwg", "dwg no"] },
      { key: "revision", label: "Revision", aliases: ["rev", "revision"] },
      { key: "onHand", label: "On hand (opening stock)", aliases: ["on hand", "qty on hand", "stock", "quantity", "qty", "inventory", "oh"] },
    ],
  },
  bom: {
    label: "Bills of materials",
    hint: "One row per component line: parent part, component part, quantity per.",
    fields: [
      { key: "parentSku", label: "Parent SKU", required: true, aliases: ["parent", "parent sku", "parent part", "assembly", "assy", "top level", "parent item", "kit"] },
      { key: "componentSku", label: "Component SKU", required: true, aliases: ["component", "component sku", "child", "child part", "part", "part number", "item", "material", "sub"] },
      { key: "qty", label: "Qty per", required: true, aliases: ["qty", "quantity", "qty per", "quantity per", "per", "usage", "qpa"] },
      { key: "scrapPct", label: "Scrap %", aliases: ["scrap", "scrap %", "scrap pct", "yield loss"] },
      { key: "rev", label: "BOM rev", aliases: ["rev", "revision", "bom rev"] },
    ],
  },
  work_centers: {
    label: "Work centers / machines",
    hint: "One row per machine or cell with an hourly rate.",
    fields: [
      { key: "code", label: "Code", required: true, aliases: ["code", "wc", "work center", "workcenter", "machine", "cell", "id"] },
      { key: "name", label: "Name", aliases: ["name", "description", "machine name"] },
      { key: "hourlyRate", label: "$ / hour", aliases: ["rate", "hourly rate", "cost per hour", "$/hr", "shop rate"] },
      { key: "capacityHoursPerDay", label: "Hours / day", aliases: ["capacity", "hours per day", "hrs/day", "daily hours"] },
    ],
  },
  stock: {
    label: "Opening stock counts",
    hint: "One row per part (and location): what is on the shelf right now and what it cost.",
    fields: [
      { key: "sku", label: "SKU", required: true, aliases: ["sku", "part", "part number", "item", "pn"] },
      { key: "qty", label: "Quantity", required: true, aliases: ["qty", "quantity", "on hand", "count", "stock"] },
      { key: "unitCost", label: "Unit cost", aliases: ["cost", "unit cost", "value", "avg cost"] },
      { key: "location", label: "Location", aliases: ["location", "bin", "rack", "shelf", "loc"] },
      { key: "lot", label: "Lot", aliases: ["lot", "lot number", "heat", "batch"] },
    ],
  },
  employees: {
    label: "Employees",
    hint: "People who clock time on the floor.",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["name", "employee", "employee name", "full name"] },
      { key: "badge", label: "Badge", aliases: ["badge", "code", "initials", "id", "employee id"] },
      { key: "hourlyRate", label: "$ / hour", aliases: ["rate", "hourly rate", "wage", "pay rate", "loaded rate"] },
      { key: "skills", label: "Skills", aliases: ["skills", "certifications", "training", "can run"] },
    ],
  },
};

export type Mapping = Record<string, string | null>; // field key -> source header

export function normalize(h: string) {
  return h
    .toLowerCase()
    .replace(/[_\-./#]+/g, " ")
    .replace(/[^a-z0-9% ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function score(header: string, field: FieldDef): number {
  const h = normalize(header);
  if (!h) return 0;
  let best = 0;
  for (const a of field.aliases) {
    const n = normalize(a);
    if (h === n) return 1;
    if (h.startsWith(n) || h.endsWith(n)) best = Math.max(best, 0.8);
    else if (h.includes(n) && n.length >= 3) best = Math.max(best, 0.6);
  }
  return best;
}

/** Best-effort column mapping from headers alone. */
export function heuristicMapping(kind: EntityKind, headers: string[]): Mapping {
  const def = ENTITIES[kind];
  const used = new Set<string>();
  const mapping: Mapping = {};
  // Greedy by score so "part number" beats "number".
  const candidates: { field: string; header: string; s: number }[] = [];
  for (const f of def.fields) for (const h of headers) candidates.push({ field: f.key, header: h, s: score(h, f) });
  candidates.sort((a, b) => b.s - a.s);
  for (const c of candidates) {
    if (c.s < 0.6) break;
    if (mapping[c.field] !== undefined || used.has(c.header)) continue;
    mapping[c.field] = c.header;
    used.add(c.header);
  }
  for (const f of def.fields) if (mapping[f.key] === undefined) mapping[f.key] = null;
  return mapping;
}

/** Guess what kind of sheet this is from its headers (and a few values). */
export function guessEntity(headers: string[], rows: Record<string, string>[]): EntityKind {
  const kinds = Object.keys(ENTITIES) as EntityKind[];
  let best: EntityKind = "items";
  let bestScore = -1;
  for (const k of kinds) {
    const m = heuristicMapping(k, headers);
    const def = ENTITIES[k];
    let s = 0;
    for (const f of def.fields) if (m[f.key]) s += f.required ? 3 : 1;
    const req = def.fields.filter((f) => f.required);
    if (!req.every((f) => m[f.key])) s -= 5;
    // BOM sheets have two part-like columns; stock sheets have qty + sku and little else.
    if (k === "bom" && m.parentSku && m.componentSku && m.parentSku !== m.componentSku) s += 4;
    if (k === "customers" && headers.some((h) => /customer|client/i.test(h))) s += 2;
    if (k === "vendors" && headers.some((h) => /vendor|supplier/i.test(h))) s += 3;
    if (k === "employees" && headers.some((h) => /employee|badge|wage/i.test(h))) s += 3;
    if (k === "work_centers" && headers.some((h) => /work ?center|machine|cell/i.test(h))) s += 3;
    if (k === "stock" && headers.some((h) => /on hand|count|bin/i.test(h)) && !headers.some((h) => /description|name/i.test(h))) s += 3;
    if (s > bestScore) {
      bestScore = s;
      best = k;
    }
  }
  void rows;
  return best;
}

export function inferItemType(row: Record<string, string>, name: string, typeValue?: string): "make" | "buy" | "phantom" | "service" {
  const t = (typeValue ?? "").toLowerCase();
  if (t.startsWith("m") || t.includes("manuf") || t.includes("assem")) return "make";
  if (t.startsWith("b") || t.includes("purch")) return "buy";
  if (t.includes("phantom")) return "phantom";
  if (t.includes("serv") || t.includes("labor") || t.includes("labour")) return "service";
  const n = name.toLowerCase();
  if (/\b(assy|assembly|kit|weldment|fabricated|machined)\b/.test(n)) return "make";
  void row;
  return "buy";
}
