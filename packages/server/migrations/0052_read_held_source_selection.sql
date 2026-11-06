-- A private capture role can list supported sources or read selected sources for an active hold.
CREATE FUNCTION public.read_held_source_selection(
  identity_provider text, identity_subject text, hold_id_value uuid, selected_sources jsonb
) RETURNS TABLE(idea_id uuid, source jsonb, body bytea, object_name text, object_digest text, object_store text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  held_idea uuid;
  include_content boolean := selected_sources IS NOT NULL;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' OR
     (include_content AND (jsonb_typeof(selected_sources) IS DISTINCT FROM 'array' OR octet_length(selected_sources::text) > 50000)) OR
     public.lock_active_legal_hold_authority(identity_provider,identity_subject) IS NULL
  THEN RAISE EXCEPTION 'Held source selection unavailable'; END IF;
  IF include_content AND jsonb_array_length(selected_sources) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Held source selection unavailable'; END IF;
  SELECT h.idea_id INTO held_idea FROM public.legal_holds h WHERE h.id=hold_id_value;
  PERFORM i.id FROM public.ideas i WHERE i.id=held_idea FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.legal_holds h WHERE h.id=hold_id_value AND h.released_at IS NULL)
  THEN RAISE EXCEPTION 'Held source selection unavailable'; END IF;

  RETURN QUERY
  WITH selection AS (
    SELECT item->>'kind' AS kind, item->>'sourceType' AS source_type,
      (item->>'sourceId')::uuid AS source_id, item->>'sourceGeneration' AS source_generation
    FROM jsonb_array_elements(selected_sources) AS inputs(item)
  ), revisions AS (
    SELECT * FROM public.idea_revisions r WHERE r.idea_id=held_idea
  ), submissions AS (
    SELECT * FROM public.registered_submissions s WHERE s.idea_id=held_idea
  ), related AS (
    SELECT 'ideas' AS source_type,i.id,CASE WHEN include_content THEN to_jsonb(i) END AS data
      FROM public.ideas i WHERE i.id=held_idea
    UNION ALL SELECT 'audit_events',a.id,CASE WHEN include_content THEN to_jsonb(a) END
      FROM public.audit_events a WHERE a.idea_id=held_idea
    UNION ALL SELECT 'approval_corrections',a.id,CASE WHEN include_content THEN to_jsonb(a) END
      FROM public.approval_corrections a WHERE a.idea_id=held_idea
    UNION ALL SELECT 'moderation_events',m.id,CASE WHEN include_content THEN to_jsonb(m) END
      FROM public.moderation_events m JOIN revisions r ON r.id=m.revision_id
    UNION ALL SELECT 'moderator_removals',m.id,CASE WHEN include_content THEN to_jsonb(m) END
      FROM public.moderator_removals m WHERE m.idea_id=held_idea
    UNION ALL SELECT 'moderator_change_requests',m.id,CASE WHEN include_content THEN to_jsonb(m) END
      FROM public.moderator_change_requests m WHERE m.idea_id=held_idea
    UNION ALL SELECT 'registered_submissions',s.id,CASE WHEN include_content THEN to_jsonb(s) END FROM submissions s
    UNION ALL SELECT 'media_previews',m.id,CASE WHEN include_content THEN to_jsonb(m) END
      FROM public.media_previews m WHERE m.idea_id=held_idea
    UNION ALL SELECT 'registered_draft_media',m.id,CASE WHEN include_content THEN to_jsonb(m) END
      FROM public.registered_draft_media m JOIN submissions s ON m.draft_id=s.draft_id AND m.revision=s.draft_revision
  ), media AS (
    SELECT m.id,m.generation,m.object_name,NULL::text AS digest,'preview'::text AS store
    FROM public.media_previews m WHERE m.idea_id=held_idea
    UNION ALL
    SELECT m.id,m.generation,m.object_name,m.digest,'upload'
    FROM public.registered_draft_media m JOIN submissions s ON m.draft_id=s.draft_id AND m.revision=s.draft_revision
    WHERE m.generation IS NOT NULL AND m.digest IS NOT NULL
  ), selected AS (
    SELECT jsonb_build_object('kind','revision','sourceId',r.id,'sourceGeneration',NULL) AS reference,
      CASE WHEN include_content THEN convert_to(to_jsonb(r)::text,'UTF8') END AS bytes,
      NULL::text AS name,NULL::text AS sha256,NULL::text AS store
    FROM revisions r
    WHERE NOT include_content OR EXISTS (SELECT 1 FROM selection s WHERE s.kind='revision' AND s.source_id=r.id)
    UNION ALL
    SELECT jsonb_build_object('kind','related_record','sourceType',r.source_type,'sourceId',r.id,'sourceGeneration',NULL),
      convert_to(r.data::text,'UTF8'),NULL,NULL,NULL
    FROM related r
    WHERE NOT include_content OR EXISTS (SELECT 1 FROM selection s
      WHERE s.kind='related_record' AND s.source_type=r.source_type AND s.source_id=r.id)
    UNION ALL
    SELECT jsonb_build_object('kind','media','sourceId',m.id,'sourceGeneration',m.generation),
      NULL,CASE WHEN include_content THEN m.object_name END,CASE WHEN include_content THEN m.digest END,
      CASE WHEN include_content THEN m.store END
    FROM media m
    WHERE NOT include_content OR EXISTS (SELECT 1 FROM selection s
      WHERE s.kind='media' AND s.source_id=m.id AND s.source_generation=m.generation)
    LIMIT 10001
  ), bounded AS (
    SELECT s.*,sum(coalesce(octet_length(s.bytes),0)) OVER () AS total_bytes FROM selected s
  )
  SELECT held_idea,b.reference,b.bytes,b.name,b.sha256,b.store FROM bounded b
    WHERE (b.bytes IS NULL OR octet_length(b.bytes) BETWEEN 1 AND 16777216) AND b.total_bytes <= 100663296
    ORDER BY b.reference;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.read_held_source_selection(text,text,uuid,jsonb) FROM PUBLIC;
