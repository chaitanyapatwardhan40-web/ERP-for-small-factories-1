# Glossary

The words the code uses, in the sense a shop uses them.

- **Item / part / SKU** — anything with a part number. Type `make` (built here), `buy` (purchased),
  `phantom` (a grouping that explodes into its parts on a work order), `service` (labour or outside
  work sold or bought).
- **BOM (bill of materials)** — the components and quantities that make one unit of an item. Has
  revisions (A, B, C); one is active. **Scrap %** adds allowance to the quantity per.
- **Routing** — the ordered operations to make an item, each on a **work center** with setup hours
  and run time per unit. An **outside** operation is done by a vendor (plating, heat treat) and is
  bought with an outside-processing PO against the work order.
- **Work center** — a machine or cell with an hourly rate and daily capacity.
- **Standard cost** — the rolled-up cost of one unit from BOM + routing + overhead policy.
  **Average cost** — the moving weighted average of what is actually in stock. **Last cost** — last
  purchase price.
- **Overhead** — a percentage of labour applied to work orders at completion (org setting).
- **Quote** — a priced offer; lines carry a cost build-up (material, labour, outside, overhead) and a
  margin; price = cost / (1 − margin). Accepting a quote creates the sales order.
- **Sales order (SO)** — a customer's commitment; lines have promised dates. **Program** groups the
  orders of one kitting program (one order per kit). Changes after confirmation are logged.
- **Work order (WO)** — the instruction to make a quantity of one item: materials (exploded BOM),
  operations (copied routing), accumulated cost (material, labour, outside, overhead).
- **Traveler** — the printed work order that travels with the job.
- **Issue** — move material from stock into WIP for a work order. **Backflush** (not yet) issues
  automatically at completion.
- **WIP (work in process)** — the asset account holding the cost of unfinished work orders.
- **Complete** — finish a work order: apply overhead, write off scrap, move good units into stock at
  actual cost, relieve WIP.
- **Purchase order (PO)** — what we buy; **receipt** books it into stock at PO cost and accrues the
  liability; the **vendor bill** later clears the accrual into payables.
- **Shortage report (what to buy)** — demand from open work orders and confirmed orders, minus stock,
  minus open POs, topped up to the reorder quantity.
- **Shipment** — what left the dock against an order; ships at average cost (COGS); the invoice is
  cut from it.
- **Invoice / bill** — receivable / payable documents; **payment** clears them.
- **Journal entry** — the balanced ledger record posted for every business event via a **posting
  rule** (event → debit subtype / credit subtype). **Period** — a month that can be locked.
- **Account subtype** — the role an account plays (cash, inventory, wip, revenue...). Rules point at
  subtypes so the chart can be renumbered freely.
- **NCR** — non-conformance report; **disposition** is what happens to the bad parts; **CAPA** is
  the corrective action.
- **Gauge** — a measuring tool with a calibration interval.
- **Lot** — a traceable batch (heat number, PO receipt, work order number).
- **Reactivation radar** — customers with no order in N months and what they used to buy.
- **Implementer** — the import wizard that reads a shop's spreadsheets, recognises what they are,
  maps the columns (heuristics, or Claude when a key is set) and loads them idempotently.
