class BackfillSupervisorInboxMemberRoles < ActiveRecord::Migration[7.1]
  def up
    execute <<~SQL.squish
      UPDATE inbox_members
      SET role = 1,
          updated_at = CURRENT_TIMESTAMP
      FROM inboxes, account_users
      WHERE inbox_members.inbox_id = inboxes.id
        AND account_users.account_id = inboxes.account_id
        AND account_users.user_id = inbox_members.user_id
        AND account_users.role = 2
        AND inbox_members.role = 0
    SQL
  end

  def down
    # Data-only migration; per-inbox role changes may be edited after migration.
  end
end
