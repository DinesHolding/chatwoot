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

    assigned_or_participating_conversations
  end

  private

  def assigned_or_participating_conversations
    conversations.left_outer_joins(:conversation_participants)
                 .where(
                   'conversations.assignee_id = :user_id OR conversation_participants.user_id = :user_id',
                   user_id: user.id
                 )
                 .distinct
  end

  def full_conversation_access?
    %w[administrator supervisor].include?(user_role)
  end

  def accessible_conversations
    conversations.where(inbox: user.inboxes.where(account_id: account.id))
  end

  def account_user
    AccountUser.find_by(account_id: account.id, user_id: user.id)
  end

  def user_role
    account_user&.role
  end
end

Conversations::PermissionFilterService.prepend_mod_with('Conversations::PermissionFilterService')
