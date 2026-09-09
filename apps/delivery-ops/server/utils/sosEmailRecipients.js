// TEMPORARY VERIFICATION OVERRIDE:
// The SoS email is currently locked to a single test recipient so the sender
// can verify content before broadcasting. To restore the full distribution
// list, remove SOS_TEST_RECIPIENT and re-enable the config-driven logic below.
const SOS_TEST_RECIPIENT = 'namratha.singh@nutanix.com';

/**
 * Resolve SoS To+CC lists.
 *
 * Verification mode: To = [namratha.singh@nutanix.com] only, CC = [].
 * Extra recipients/CC and the config defaults are intentionally ignored while
 * the override above is active.
 */
function resolveSosRecipientLists() {
  return { toList: [SOS_TEST_RECIPIENT], ccList: [] };
}

module.exports = { resolveSosRecipientLists };
