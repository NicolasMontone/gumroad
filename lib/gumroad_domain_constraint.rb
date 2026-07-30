# frozen_string_literal: true

class GumroadDomainConstraint
  def self.matches?(request)
    return true if VALID_REQUEST_HOSTS.include?(request.host)

    # v0 preview: allow the proxied preview host (e.g. *.vercel.run,
    # *.vusercontent.net) in development so the app's domain-constrained routes
    # render under the preview iframe.
    if defined?(PREVIEW_HOST_SUFFIXES) && PREVIEW_HOST_SUFFIXES.present?
      host = request.host.to_s
      return true if PREVIEW_HOST_SUFFIXES.any? { |suffix| host.end_with?(suffix) }
    end

    false
  end
end
