# frozen_string_literal: true

class GumroadDomainConstraint
  # In development the app may be served through the v0 / Vercel Sandbox preview
  # proxy, which uses a dynamic *.vercel.run host. Accept those so the app is
  # reachable from the preview without hardcoding the rotating subdomain.
  PREVIEW_HOST_SUFFIXES = [".vercel.run"].freeze

  def self.matches?(request)
    VALID_REQUEST_HOSTS.include?(request.host) || preview_host?(request.host)
  end

  def self.preview_host?(host)
    return false unless Rails.env.development?
    return false if host.blank?

    PREVIEW_HOST_SUFFIXES.any? { |suffix| host.end_with?(suffix) }
  end
end
