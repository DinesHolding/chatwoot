# == Schema Information
#
# Table name: inbox_members
#
#  id         :integer          not null, primary key
#  role       :integer          default("agent"), not null
#  created_at :datetime         not null
#  updated_at :datetime         not null
#  inbox_id   :integer          not null
#  user_id    :integer          not null
#
# Indexes
#
#  index_inbox_members_on_inbox_id_and_role     (inbox_id,role)
#  index_inbox_members_on_inbox_id              (inbox_id)
#  index_inbox_members_on_inbox_id_and_user_id  (inbox_id,user_id) UNIQUE
#

class InboxMember < ApplicationRecord
  enum role: { agent: 0, supervisor: 1 }

  validates :inbox_id, presence: true
  validates :user_id, presence: true
  validates :user_id, uniqueness: { scope: :inbox_id }

  belongs_to :user
  belongs_to :inbox

  after_create :add_agent_to_round_robin, if: :agent?
  after_update :sync_round_robin_membership, if: :saved_change_to_role?
  after_destroy :remove_agent_from_round_robin

  private

  def sync_round_robin_membership
    agent? ? add_agent_to_round_robin : remove_agent_from_round_robin
  end

  def add_agent_to_round_robin
    ::AutoAssignment::InboxRoundRobinService.new(inbox: inbox).add_agent_to_queue(user_id)
  end

  def remove_agent_from_round_robin
    ::AutoAssignment::InboxRoundRobinService.new(inbox: inbox).remove_agent_from_queue(user_id) if inbox.present?
  end
end

InboxMember.include_mod_with('Audit::InboxMember')
