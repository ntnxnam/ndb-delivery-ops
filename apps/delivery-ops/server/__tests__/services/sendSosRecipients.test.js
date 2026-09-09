const { resolveSosRecipientLists } = require('../../utils/sosEmailRecipients');

describe('resolveSosRecipientLists (verification override)', () => {
  test('sends only to the single test recipient with no CC', () => {
    const { toList, ccList } = resolveSosRecipientLists('someone.else@nutanix.com', 'a@nutanix.com', 'b@nutanix.com');

    expect(toList).toEqual(['namratha.singh@nutanix.com']);
    expect(ccList).toEqual([]);
  });

  test('ignores sender and extra recipients while override is active', () => {
    const { toList, ccList } = resolveSosRecipientLists('test.user@nutanix.com', '', '');

    expect(toList).toEqual(['namratha.singh@nutanix.com']);
    expect(ccList).toEqual([]);
  });
});
