// Phone number masking so no interface, log, or URL ever shows a full number.
// Examples: 09309636315 -> 0936***6315, 1234 -> ****
function maskPhone(phone) {
    if (typeof phone !== 'string') return '****';
    const digits = phone.replace(/\s/g, '');
    if (digits.length <= 6) return digits.slice(0, 2) + '*'.repeat(Math.max(digits.length - 2, 0));
    return digits.slice(0, 4) + '****' + digits.slice(-4);
}

module.exports = { maskPhone };
