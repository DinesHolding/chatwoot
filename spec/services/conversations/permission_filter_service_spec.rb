require 'rails_helper'

RSpec.describe Conversations::PermissionFilterService do
  let(:account) { create(:account) }
  let!(:conversation) { create(:conversation, account: account, inbox: inbox) }
  let!(:another_conversation) { create(:conversation, account: account, inbox: inbox) }
  let(:admin) { create(:user, account: account, role: :administrator) }
  let(:supervisor) { create(:user, account: account, role: :supervisor) }
  let(:agent) { create(:user, account: account, role: :agent) }
  let!(:inbox) { create(:inbox, account: account) }

  # This inbox_member is used to establish the agent's access to the inbox
  before { create(:inbox_member, user: agent, inbox: inbox) }

  describe '#perform' do
    context 'when user is an administrator' do
      it 'returns all conversations' do
        result = described_class.new(
          account.conversations,
          admin,
          account
        ).perform

        expect(result).to include(conversation)
        expect(result).to include(another_conversation)
        expect(result.count).to eq(2)
      end
    end

    context 'when user is a supervisor' do
      it 'returns all conversations' do
        result = described_class.new(
          account.conversations,
          supervisor,
          account
        ).perform

        expect(result).to include(conversation)
        expect(result).to include(another_conversation)
        expect(result.count).to eq(2)
      end
    end

    context 'when user is an agent' do
      before do
        conversation.update!(assignee: agent)
        create(:conversation_participant, conversation: another_conversation, user: agent)
      end

      it 'returns only assigned or participating conversations' do
        other_conversation = create(:conversation, account: account, inbox: inbox)
        result = described_class.new(
          account.conversations,
          agent,
          account
        ).perform

        expect(result).to include(conversation)
        expect(result).to include(another_conversation)
        expect(result).not_to include(other_conversation)
        expect(result.count).to eq(2)
      end
    end
  end
end
