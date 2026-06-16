-- Track 2: tag each pool URL with the connector that owns it, so the server-side
-- extractor can pick the right strategy for a rendered DOM.
ALTER TABLE pool_url_registry ADD COLUMN source TEXT;
