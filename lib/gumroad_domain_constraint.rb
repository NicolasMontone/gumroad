# frozen_string_literal: true

class GumroadDomainConstraint
  def self.matches?(request)
    return true if VALID_REQUEST_HOSTS.include?(request.host)

    # v0 preview: allow the proxied *.vercel.run host in development so the
    # app's domain-constrained routes render under the preview iframe.
    if defined?(PREVIEW_HOST_SUFFIX) && PREVIEW_HOST_SUFFIX.present?
      return true if request.host.to_s.end_with?(PREVIEW_HOST_SUFFIX)
    end

    false
  end
end
