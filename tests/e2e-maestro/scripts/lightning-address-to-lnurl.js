const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index++) {
      if ((top >>> index) & 1) checksum ^= generators[index];
    }
  }
  return checksum >>> 0;
}

function expandHrp(hrp) {
  const expanded = [];
  for (let index = 0; index < hrp.length; index++) expanded.push(hrp.charCodeAt(index) >>> 5);
  expanded.push(0);
  for (let index = 0; index < hrp.length; index++) expanded.push(hrp.charCodeAt(index) & 31);
  return expanded;
}

function convertEightToFiveBits(bytes) {
  let accumulator = 0;
  let bitCount = 0;
  const result = [];
  for (const byte of bytes) {
    accumulator = ((accumulator << 8) | byte) & 0xfff;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      result.push((accumulator >>> bitCount) & 31);
    }
  }
  if (bitCount > 0) result.push((accumulator << (5 - bitCount)) & 31);
  return result;
}

function encodeLnurl(url) {
  const bytes = [];
  for (let index = 0; index < url.length; index++) {
    const code = url.charCodeAt(index);
    if (code > 0x7f) throw new Error('LNURL fixture URL must contain ASCII only');
    bytes.push(code);
  }

  const hrp = 'lnurl';
  const data = convertEightToFiveBits(bytes);
  const checksumInput = expandHrp(hrp).concat(data, [0, 0, 0, 0, 0, 0]);
  const checksum = polymod(checksumInput) ^ 1;
  const checksumValues = [];
  for (let index = 0; index < 6; index++) checksumValues.push((checksum >>> (5 * (5 - index))) & 31);
  return hrp + '1' + data.concat(checksumValues).map(value => charset[value]).join('');
}

const copied = String(maestro.copiedText || '').trim();
const match = copied.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
if (!match) throw new Error('No Lightning address found in copied UI text');

const addressParts = match[0].toLowerCase().split('@');
const lnurlPayUrl = `https://${addressParts[1]}/.well-known/lnurlp/${encodeURIComponent(addressParts[0])}`;
output.lnurlPay = encodeLnurl(lnurlPayUrl).toUpperCase();
