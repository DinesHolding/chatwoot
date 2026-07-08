import InboxMembersAPI from '../../api/inboxMembers';

export const actions = {
  get(_, { inboxId }) {
    return InboxMembersAPI.show(inboxId);
  },
  create(_, { inboxId, agentList = [], members = null }) {
    return InboxMembersAPI.update({ inboxId, agentList, members });
  },
};

export default {
  namespaced: true,
  actions,
};
