class Api::V1::Accounts::AssignableAgentsController < Api::V1::Accounts::BaseController
  before_action :fetch_inboxes

  def index
    member_ids = @inboxes.map do |inbox|
      authorize inbox, :show?
      inbox.inbox_members.pluck(:user_id)
    end
    member_ids = member_ids.inject(:&)
    members = Current.account.users.where(id: member_ids)
    @assignable_agents = (members + Current.account.administrators).uniq
  end

  private

  def fetch_inboxes
    @inboxes = Current.account.inboxes.find(permitted_params[:inbox_ids])
  end

  def permitted_params
    params.permit(inbox_ids: [])
  end
end
