class Api::V1::Accounts::InboxMembersController < Api::V1::Accounts::BaseController
  before_action :fetch_inbox
  before_action :current_member_ids, only: [:create, :update]

  def show
    authorize @inbox, :show?
    fetch_updated_agents
  end

  def create
    authorize @inbox, :create?
    ActiveRecord::Base.transaction do
      @inbox.upsert_members(member_attributes.select { |member| member_ids_to_be_added.include?(member[:user_id]) })
    end
    fetch_updated_agents
  end

  def update
    authorize @inbox, :update?
    update_agents_list
    fetch_updated_agents
  end

  def destroy
    authorize @inbox, :destroy?
    ActiveRecord::Base.transaction do
      @inbox.remove_members(params[:user_ids])
    end
    head :ok
  end

  private

  def fetch_updated_agents
    @inbox_members = @inbox.inbox_members.includes(user: { avatar_attachment: [:blob] })
  end

  def update_agents_list
    # get all the user_ids which the inbox currently has as members.
    # get the list of  user_ids from params
    # the missing ones are the agents which are to be deleted from the inbox
    # the new ones are the agents which are to be added to the inbox
    ActiveRecord::Base.transaction do
      @inbox.upsert_members(member_attributes)
      @inbox.remove_members(members_to_be_removed_ids)
    end
  end

  def member_ids_to_be_added
    requested_member_ids - @current_member_ids
  end

  def members_to_be_removed_ids
    @current_member_ids - requested_member_ids
  end

  def current_member_ids
    @current_member_ids = @inbox.inbox_members.pluck(:user_id)
  end

  def requested_member_ids
    @requested_member_ids ||= member_attributes.pluck(:user_id)
  end

  def member_attributes
    @member_attributes ||= if params[:members].present?
                             params[:members].filter_map do |member|
                               user_id = member[:user_id] || member['user_id'] || member[:id] || member['id']
                               next if user_id.blank?

                               {
                                 user_id: user_id.to_i,
                                 role: normalize_member_role(member[:role] || member['role'])
                               }
                             end
                           else
                             Array(params[:user_ids]).map do |user_id|
                               { user_id: user_id.to_i, role: 'agent' }
                             end
                           end
  end

  def normalize_member_role(role)
    role = role.to_s
    InboxMember.roles.key?(role) ? role : 'agent'
  end

  def fetch_inbox
    @inbox = Current.account.inboxes.find(params[:inbox_id])
  end
end
