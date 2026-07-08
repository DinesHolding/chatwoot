json.payload do
  json.array! @inbox_members do |inbox_member|
    json.partial! 'api/v1/models/agent', formats: [:json], resource: inbox_member.user
    json.inbox_role inbox_member.role
  end
end
