'use strict';

/** Collapse a header to a comparable key: "Contact1_Phone1 DNC" -> "contact1phone1dnc" */
const key = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Repeating skip-trace blocks. Indexes are read from the header, so a file with
// 8 contacts and 12 phones each works without any code change.
const RX = {
  phone:     /^contact(\d+)phone(\d+)$/,
  phoneDnc:  /^contact(\d+)phone(\d+)dnc$/,
  phoneSeen: /^contact(\d+)phone(\d+)lastseen$/,
  email:     /^contact(\d+)email(\d+)$/,
  cFirst:    /^contact(\d+)first(?:name)?$/,
  cLast:     /^contact(\d+)last(?:name)?$/,
  oFirst:    /^owner(\d+)firstname$/,
  oLast:     /^owner(\d+)lastname$/,
  oBiz:      /^owner(\d+)businessname$/,
};

// Property address, most specific name first. Exact key match only, so
// "Mailing Street" and "Listing Office Address" can never be picked up here.
const ADDRESS_SYNONYMS = {
  address: ['propertyaddress', 'propertystreet', 'siteaddress', 'streetaddress', 'street', 'address', 'address1', 'addressline1'],
  city:    ['propertycity', 'sitecity', 'city'],
  state:   ['propertystate', 'sitestate', 'state', 'st'],
  zip:     ['propertyzip', 'propertypostalcode', 'sitezip', 'zip', 'zipcode', 'postalcode', 'postcode'],
};

/**
 * Build a column map from a header row.
 * Returns indexes, never names, so lookups during the row loop are O(1).
 */
function detect(header) {
  const idx = new Map();
  header.forEach((h, i) => { const k = key(h); if (k && !idx.has(k)) idx.set(k, i); });

  const contacts = new Map(); // n -> { first, last, phones:[{i,dnc,seen,slot}], emails:[{i,slot}] }
  const owners = new Map();   // n -> { first, last, biz }

  const contact = (n) => {
    if (!contacts.has(n)) contacts.set(n, { n, first: -1, last: -1, phones: [], emails: [] });
    return contacts.get(n);
  };
  const owner = (n) => {
    if (!owners.has(n)) owners.set(n, { n, first: -1, last: -1, biz: -1 });
    return owners.get(n);
  };

  const pendingDnc = new Map();  // "n:m" -> col
  const pendingSeen = new Map();

  header.forEach((h, i) => {
    const k = key(h);
    let m;
    if ((m = RX.phoneDnc.exec(k)))       { pendingDnc.set(m[1] + ':' + m[2], i); return; }
    if ((m = RX.phoneSeen.exec(k)))      { pendingSeen.set(m[1] + ':' + m[2], i); return; }
    if ((m = RX.phone.exec(k)))          { contact(+m[1]).phones.push({ i, slot: +m[2], dnc: -1, seen: -1 }); return; }
    if ((m = RX.email.exec(k)))          { contact(+m[1]).emails.push({ i, slot: +m[2] }); return; }
    if ((m = RX.cFirst.exec(k)))         { contact(+m[1]).first = i; return; }
    if ((m = RX.cLast.exec(k)))          { contact(+m[1]).last = i; return; }
    if ((m = RX.oFirst.exec(k)))         { owner(+m[1]).first = i; return; }
    if ((m = RX.oLast.exec(k)))          { owner(+m[1]).last = i; return; }
    if ((m = RX.oBiz.exec(k)))           { owner(+m[1]).biz = i; return; }
  });

  // Attach the DNC / LastSeen companions to their phone column.
  for (const c of contacts.values()) {
    for (const p of c.phones) {
      const tag = c.n + ':' + p.slot;
      if (pendingDnc.has(tag)) p.dnc = pendingDnc.get(tag);
      if (pendingSeen.has(tag)) p.seen = pendingSeen.get(tag);
    }
    c.phones.sort((a, b) => a.slot - b.slot);
    c.emails.sort((a, b) => a.slot - b.slot);
  }

  const pick = (names) => { for (const n of names) if (idx.has(n)) return idx.get(n); return -1; };

  const map = {
    address: pick(ADDRESS_SYNONYMS.address),
    city:    pick(ADDRESS_SYNONYMS.city),
    state:   pick(ADDRESS_SYNONYMS.state),
    zip:     pick(ADDRESS_SYNONYMS.zip),
    contacts: [...contacts.values()].sort((a, b) => a.n - b.n),
    owners:   [...owners.values()].sort((a, b) => a.n - b.n),
  };

  map.totalPhoneCols = map.contacts.reduce((s, c) => s + c.phones.length, 0);
  map.totalEmailCols = map.contacts.reduce((s, c) => s + c.emails.length, 0);
  return map;
}

/** Human-readable summary of what was found, for the UI. */
function describe(map) {
  const missing = ['address', 'city', 'state', 'zip'].filter((f) => map[f] < 0);
  return {
    contacts: map.contacts.length,
    owners: map.owners.length,
    phoneCols: map.totalPhoneCols,
    emailCols: map.totalEmailCols,
    missing,
    usable: map.totalPhoneCols > 0,
  };
}

module.exports = { detect, describe, key, ADDRESS_SYNONYMS };
