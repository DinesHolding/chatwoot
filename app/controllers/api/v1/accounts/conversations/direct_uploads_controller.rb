class Api::V1::Accounts::Conversations::DirectUploadsController < ActiveStorage::DirectUploadsController
  include EnsureCurrentAccountHelper
  before_action :current_account
  before_action :conversation

  def create
    return if @conversation.nil? || @current_account.nil?

    super
  end

  private

  def conversation
    @conversation ||= Current.account.conversations.find_by(display_id: params[:conversation_id])
    return head :not_found if @conversation.blank?
    return if ConversationPolicy.new(user_context, @conversation).show?

    head :forbidden
  end

  def user_context
    {
      user: current_user || @resource,
      account: Current.account,
      account_user: Current.account_user
    }
  end
end
