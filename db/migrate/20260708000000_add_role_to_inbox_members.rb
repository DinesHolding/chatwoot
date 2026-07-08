class AddRoleToInboxMembers < ActiveRecord::Migration[7.1]
  def change
    add_column :inbox_members, :role, :integer, default: 0, null: false
    add_index :inbox_members, [:inbox_id, :role]
  end
end
