/* global axios */
import ApiClient from './ApiClient';

class InboxMembers extends ApiClient {
  constructor() {
    super('inbox_members', { accountScoped: true });
  }

  update({ inboxId, agentList, members }) {
    return axios.patch(this.url, {
      inbox_id: inboxId,
      members:
        members ||
        agentList.map(userId => ({
          user_id: userId,
          role: 'agent',
        })),
    });
  }
}

export default new InboxMembers();
