// Parsertests: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const P = require("../js/parser.js");

function parse(lines) {
  return P.parseMenu(lines.join("\n"));
}
function find(items, name) {
  return items.find(i => i.displayName.toLowerCase().startsWith(name.toLowerCase()));
}

test("herkent bekende dranken met volume en prijs", () => {
  const { items } = parse(["Duvel 33cl .... € 4,50", "Jupiler 25cl ..... € 2,80"]);
  const duvel = find(items, "Duvel");
  assert.strictEqual(duvel.matchedName, "Duvel");
  assert.strictEqual(duvel.volMl, 330);
  assert.strictEqual(duvel.price, 4.5);
  assert.ok(Math.abs(duvel.score - 330 * 0.085 / 4.5) < 1e-9);
  assert.strictEqual(items[0].displayName, "Duvel"); // hoogste score eerst
});

test("standaardvolume als de kaart er geen vermeldt", () => {
  const { items } = parse(["Orval ....... € 5,00"]);
  assert.strictEqual(items[0].volMl, 330);
  assert.strictEqual(items[0].volAssumed, true);
});

test("bedrag met €-teken wint van een los decimaal getal", () => {
  const { items } = parse(["Duvel € 4,50 (2,5 cl)"]);
  assert.strictEqual(items[0].price, 4.5);
});

test("frisdrank, koffie en alcoholvrij worden overgeslagen", () => {
  const { items, unmatched } = parse([
    "Cola ...... € 2,60", "Spa bruis ..... € 2,40", "Koffie ..... € 2,80",
    "Jupiler 0.0 ..... € 2,80", "Virgin mojito ..... € 6,00",
  ]);
  assert.deepStrictEqual(items, []);
  assert.deepStrictEqual(unmatched, []);
});

test("korte trefwoorden matchen enkel als los woord", () => {
  const { items } = parse(["Ginger ale ..... € 3,20", "Steak frites ..... € 18,50"]);
  assert.strictEqual(items.length, 0);
});

test("gin-tonic blijft een cocktail ondanks het trefwoord tonic", () => {
  const { items } = parse(["Gin-tonic ....... € 9,00"]);
  assert.strictEqual(items[0].matchedName, "Gin-tonic");
});

test("categorie-schatting voor onbekende dranken", () => {
  const { items } = parse(["Huisgemaakte tripel ..... € 4,00", "Spaanse wijn ..... € 4,50"]);
  assert.strictEqual(find(items, "Huisgemaakte").source, "schatting");
  assert.strictEqual(find(items, "Huisgemaakte").abv, 8.5);
  assert.ok(find(items, "Spaanse wijn")); // "spa" mag "spaanse" niet wegfilteren
});
