class Conversations::PermissionFilterService
  attr_reader :conversations, :user, :account

  def initialize(conversations, user, account)
    @conversations = conversations
    @user = user
    @account = account
  end

  def perform
    return conversations.none if user.blank?
    return conversations if full_conversation_access?

    visible_conversations
  end

  private

  def visible_conversations
    conversations.where(
      <<~SQL.squish,
        conversations.inbox_id IN (:supervised_inbox_ids)
        OR conversations.assignee_id = :user_id
        OR EXISTS (
          SELECT 1 FROM conversation_participants
          WHERE conversation_participants.conversation_id = conversations.id
            AND conversation_participants.user_id = :user_id
        )
      SQL
      supervised_inbox_ids: supervised_inbox_ids,
      user_id: user.id
    ).distinct
  end

  def assigned_or_participating_conversations
    conversations.where(
      <<~SQL.squish,
        conversations.assignee_id = :user_id OR EXISTS (
          SELECT 1 FROM conversation_participants
          WHERE conversation_participants.conversation_id = conversations.id
            AND conversation_participants.user_id = :user_id
        )
      SQL
      user_id: user.id
    ).distinct
  end

  def accessible_conversations
    conversations.where(inbox: user.inboxes.where(account_id: account.id))
  end

  def full_conversation_access?
    user_role == 'administrator'
  end

  def supervised_inbox_ids
    @supervised_inbox_ids ||= user.supervised_inboxes(account).pluck(:id).presence || [0]
  end

  def account_user
    AccountUser.find_by(account_id: account.id, user_id: user.id)
  end

  def user_role
    account_user&.role
  end
end

Conversations::PermissionFilterService.prepend_mod_with('Conversations::PermissionFilterService')
