/**
 * Tests for telegram-bot/product-parse.ts — turning the model's JSON into the
 * fields the wishlist stores.
 *
 *   npm run test:scraper
 *
 * Pure functions only: no OpenAI, no network, no API key, so this runs in CI.
 *
 * The regression this exists for is not a crash. The scraper asked the model
 * for "Product Name" and then read `data.name`, so a page that scraped
 * perfectly — name, image and description all correct — was saved as
 * "Unknown Product" with a null price, and nothing anywhere reported a
 * problem. Every key spelling the model might plausibly use is pinned here.
 */
import {
  parsePrice, parseText, pick, toProductDetails,
} from '../telegram-bot/product-parse.js';

let pass = 0;
let fail = 0;
const eq = (name: string, actual: unknown, expected: unknown) => {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`);
  good ? pass++ : fail++;
};

// ── pick: the key spelling must not matter ─────────────────
{
  const prose = {
    'Product Name': 'Enamor IO05 Bra',
    Price: '₹1,049.00',
    Currency: 'INR',
    'Primary Product Image URL': 'https://m.media-amazon.com/images/I/71SerQyzDUL.jpg',
    'Short Description': 'Bamboo cotton.',
    'Review Summary': '4.2 out of 5 stars from 41 reviews',
  };
  eq('a prose-labelled key is found', pick(prose, 'name', 'productName'), 'Enamor IO05 Bra');
  eq('an underscored key is found', pick({ product_name: 'X' }, 'name', 'productName'), 'X');
  eq('a camelCase key is found', pick({ productName: 'Y' }, 'name', 'productName'), 'Y');
  eq('a hyphenated key is found', pick({ 'product-name': 'Z' }, 'name', 'productName'), 'Z');
  eq('a SCREAMING key is found', pick({ NAME: 'W' }, 'name'), 'W');
  eq('a spaced key with odd case is found', pick({ 'product   name': 'V' }, 'name', 'productName'), 'V');
  eq('the first alias that is present wins', pick({ name: 'a', productName: 'b' }, 'name', 'productName'), 'a');
  eq('a null value falls through to the next alias', pick({ name: null, productName: 'b' }, 'name', 'productName'), 'b');
  eq('a missing key is null, not undefined', pick({}, 'name'), null);
  eq('an empty object is safe', pick({}, 'name', 'price'), null);
}

// ── pick: falsy-but-present values are returned, not skipped ─
{
  // 0 is a legitimate price, and `value || fallback` would lose it.
  eq('a price of zero is returned', pick({ price: 0 }, 'price'), 0);
  eq('an empty string is returned', pick({ name: '' }, 'name'), '');
  eq('false is returned', pick({ reviews: false }, 'reviews'), false);
}

// ── parsePrice ─────────────────────────────────────────────
eq('a plain number', parsePrice(1049), 1049);
eq('a decimal number', parsePrice(1299.5), 1299.5);
eq('zero is a price', parsePrice(0), 0);
eq('a rupee string', parsePrice('₹1,049.00'), 1049);
eq('an Rs. string', parsePrice('Rs. 1299'), 1299);
eq('an "Rs." with a decimal', parsePrice('Rs. 1,299.50'), 1299.5);
eq('an Indian-grouped lakh', parsePrice('1,04,999'), 104999);
eq('an Indian-grouped lakh with paise', parsePrice('₹1,04,999.50'), 104999.5);
eq('a string with a trailing currency', parsePrice('1049 INR'), 1049);
eq('a trailing dot does not change the price', parsePrice('1299.'), 1299);
eq('an unreadable price is null', parsePrice('N/A'), null);
eq('an em dash is null', parsePrice('—'), null);
eq('an empty string is null', parsePrice(''), null);
eq('null is null', parsePrice(null), null);
eq('undefined is null', parsePrice(undefined), null);
eq('an object is null, not NaN', parsePrice({}), null);
eq('an array is null', parsePrice([1, 2]), null);
eq('NaN is null', parsePrice(NaN), null);
eq('Infinity is null', parsePrice(Infinity), null);
eq('a negative number is null', parsePrice(-5), null);
eq('a bare dot is null', parsePrice('.'), null);

// ── parseText ──────────────────────────────────────────────
eq('a string is trimmed', parseText('  Bra  '), 'Bra');
eq('a blank string is null', parseText('   '), null);
eq('an empty string is null', parseText(''), null);
eq('a number is null', parseText(42), null);
eq('an object is null', parseText({ a: 1 }), null);
eq('an array is null', parseText(['a']), null);
eq('null is null', parseText(null), null);

// ── toProductDetails: the real Amazon shape ────────────────
{
  // Exactly what the model returned for https://amzn.in/d/0i9oaa5g.
  const real = toProductDetails({
    'Product Name': 'Enamor IO05 Padded Wire-Free High Coverage Bamboo Cotton T-Shirt Bra',
    Price: null,
    Currency: null,
    'Primary Product Image URL': 'https://m.media-amazon.com/images/I/71SerQyzDUL._SY741_.jpg',
    'Short Description': 'Bamboo cotton wirefree padded T-shirt bra.',
    'Review Summary': null,
  });
  eq(
    'the prose-labelled name is not lost',
    real.name,
    'Enamor IO05 Padded Wire-Free High Coverage Bamboo Cotton T-Shirt Bra',
  );
  eq('the image survives the prose label', real.imageUrl, 'https://m.media-amazon.com/images/I/71SerQyzDUL._SY741_.jpg');
  eq('the description survives the prose label', real.description, 'Bamboo cotton wirefree padded T-shirt bra.');
  eq('a missing currency defaults to INR', real.currency, 'INR');
  eq('a missing price is null', real.price, null);
  eq('a missing review summary is null', real.reviews, null);
}

// ── toProductDetails: the requested shape ──────────────────
{
  const good = toProductDetails({
    name: 'Enamor IO05 Bra',
    price: 1049,
    currency: 'inr',
    imageUrl: 'https://example.com/i.jpg',
    description: 'Bamboo cotton.',
    reviews: '4.2 out of 5 stars from 41 reviews',
  });
  eq('the requested keys work', good, {
    name: 'Enamor IO05 Bra',
    price: 1049,
    currency: 'INR',
    imageUrl: 'https://example.com/i.jpg',
    description: 'Bamboo cotton.',
    reviews: '4.2 out of 5 stars from 41 reviews',
  });
  eq('the currency is upper-cased', good.currency, 'INR');
}

// ── toProductDetails: degenerate input ─────────────────────
{
  const empty = toProductDetails({});
  eq('an empty object still yields a usable row', empty, {
    name: 'Unknown Product',
    price: null,
    currency: 'INR',
    imageUrl: null,
    description: null,
    reviews: null,
  });
  eq('the name falls back rather than being null', empty.name, 'Unknown Product');
}

{
  // Jina's own Title line is a reasonable name when the model offers nothing.
  const titled = toProductDetails({ title: 'Buy Enamor IO05 Bra at Amazon.in' });
  eq('a title is accepted as the name', titled.name, 'Buy Enamor IO05 Bra at Amazon.in');
}

{
  const messy = toProductDetails({ name: '   ', price: '₹0', currency: '  ', imageUrl: '   ' });
  eq('whitespace-only text becomes null', messy.imageUrl, null);
  eq('whitespace-only currency defaults to INR', messy.currency, 'INR');
  eq('a whitespace-only name falls back', messy.name, 'Unknown Product');
  eq('a price of ₹0 is kept as 0', messy.price, 0);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
