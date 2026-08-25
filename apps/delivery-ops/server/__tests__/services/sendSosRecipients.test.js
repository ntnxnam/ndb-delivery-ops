const { resolveSosRecipientLists } = require('../../utils/sosEmailRecipients');
const emailConfig = require('../../config/emailConfig.json');
const emailSenderCCConfig = require('../../config/emailSenderCCConfig.json');

describe('resolveSosRecipientLists', () => {
  test('applies status-sender defaultTo and emailSenderCCConfig plus sender', () => {
    const { toList, ccList } = resolveSosRecipientLists('namratha.singh@nutanix.com');

    expect(toList).toEqual(emailConfig.defaultTo.map((e) => e.toLowerCase()));
    expect(toList).toContain('ndb-projects-updates@nutanix.com');

    for (const addr of emailSenderCCConfig.defaultCC) {
      const normalized = addr.toLowerCase();
      if (!toList.includes(normalized)) {
        expect(ccList).toContain(normalized);
      }
    }
    expect(ccList).toContain('namratha.singh@nutanix.com');
  });

  test('does not require client recipients', () => {
    const { toList } = resolveSosRecipientLists('test.user@nutanix.com', '', '');
    expect(toList.length).toBeGreaterThan(0);
  });
});
