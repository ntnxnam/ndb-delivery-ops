const { resolveSosRecipientLists } = require('../../utils/sosEmailRecipients');

describe('resolveSosRecipientLists', () => {
  test('uses sosEmailConfig defaults (placeholders may be empty) plus extras and sender', () => {
    const { toList, ccList } = resolveSosRecipientLists(
      'sender@nutanix.com',
      'extra.to@nutanix.com',
      'extra.cc@nutanix.com'
    );

    expect(toList).toContain('extra.to@nutanix.com');
    expect(ccList).toContain('extra.cc@nutanix.com');
    expect(ccList).toContain('sender@nutanix.com');
    expect(ccList).not.toContain('extra.to@nutanix.com');
  });

  test('omits sender from CC when not @nutanix.com', () => {
    const { toList, ccList } = resolveSosRecipientLists(
      'sender@gmail.com',
      'ok@nutanix.com',
      ''
    );

    expect(toList).toEqual(['ok@nutanix.com']);
    expect(ccList).toEqual([]);
  });
});

