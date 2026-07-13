# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Conversation, '#validate_gd_commercial_resolution' do
  let(:conversation) { create(:conversation, status: :open) }
  let(:agent) { create(:user) }

  before { Current.user = agent }
  after { Current.user = nil }

  def with_commercial_inbox(&)
    with_modified_env(
      'GD_ODOO_COMMERCIAL_INBOX_IDS' => conversation.inbox_id.to_s,
      'GD_ODOO_COMMERCIAL_ACCOUNT_IDS' => conversation.account_id.to_s,
      &
    )
  end

  it 'blocks a human resolution without an Odoo outcome' do
    with_commercial_inbox do
      expect(conversation.update(status: :resolved)).to be(false)
      expect(conversation.errors.full_messages.join(' ')).to include('pestaña Odoo')
      expect(conversation.reload).to be_open
    end
  end

  it 'allows no-sale only with a linked lead and valid reason' do
    conversation.custom_attributes = {
      'gd_odoo_lead_id' => 123,
      'gd_outcome' => 'no_sale',
      'gd_outcome_reason' => 'not_interested'
    }

    with_commercial_inbox do
      expect(conversation.update(status: :resolved)).to be(true)
      expect(conversation.custom_attributes['gd_resolved_by_agent_id']).to eq(agent.id)
    end
  end

  it 'requires a confirmed Odoo order for a sale outcome' do
    conversation.custom_attributes = {
      'gd_odoo_lead_id' => 123,
      'gd_outcome' => 'sale'
    }

    with_commercial_inbox do
      expect(conversation.update(status: :resolved)).to be(false)
      expect(conversation.errors.full_messages.join(' ')).to include('confirmada en Odoo')
    end
  end

  it 'does not affect inboxes outside the configured commercial list' do
    with_modified_env(
      'GD_ODOO_COMMERCIAL_INBOX_IDS' => '999999',
      'GD_ODOO_COMMERCIAL_ACCOUNT_IDS' => conversation.account_id.to_s
    ) do
      expect(conversation.update(status: :resolved)).to be(true)
    end
  end
end
