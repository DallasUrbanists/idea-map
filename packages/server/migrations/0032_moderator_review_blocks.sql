-- Private pending content only; the server supplies a verified provider subject.
-- This function grants no access by itself and excludes contact and ownership data.
CREATE OR REPLACE FUNCTION public.read_moderator_revision(identity_provider text, identity_subject text, target_revision uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor uuid;
  target_idea uuid;
  result jsonb;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Moderation requires read committed isolation'; END IF;
  IF identity_provider IS NULL OR identity_subject IS NULL OR target_revision IS NULL THEN RAISE EXCEPTION 'Invalid moderator review'; END IF;
  SELECT a.user_id INTO actor FROM public.identities i JOIN public.moderator_assignments a ON a.user_id=i.user_id
    WHERE i.provider=identity_provider AND i.subject=identity_subject AND a.revoked_at IS NULL FOR SHARE OF i,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'Moderator authorization required'; END IF;
  SELECT i.id INTO target_idea FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
    WHERE r.id=target_revision FOR UPDATE OF i,r;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.idea_revisions r WHERE r.id=target_revision AND octet_length(r.content::text)>262144) THEN
    RAISE EXCEPTION 'Review content exceeds the supported size';
  END IF;
  IF (SELECT count(*) FROM public.moderator_holds h JOIN public.idea_revisions held ON held.id=h.revision_id WHERE held.idea_id=target_idea AND h.released_at IS NULL)>100 THEN
    RAISE EXCEPTION 'Review blocks exceed the supported count';
  END IF;
  SELECT jsonb_build_object(
    'ideaId', i.id, 'revisionId', r.id, 'version', r.version, 'content', r.content,
    'reviewState', r.review_state, 'assessmentId', a.id, 'assessmentReceivedAt', a.received_at,
    'deadline', a.deadline, 'blocked', COALESCE(g.blocked,false),
    'activeHoldCount', (SELECT count(*) FROM public.moderator_holds h JOIN public.idea_revisions held ON held.id=h.revision_id WHERE held.idea_id=i.id AND h.released_at IS NULL),
    'activeChangeRequestCount', (SELECT count(*) FROM public.moderator_change_requests c WHERE c.idea_id=i.id AND c.resolved_at IS NULL),
    'activeHolds', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',h.id,'kind',h.kind,'reason',h.reason,'placedAt',h.created_at,
      'ownerId',COALESCE(t.owner_id,h.owner_id),'sequence',COALESCE(t.sequence,0)
      ) ORDER BY h.created_at,h.id),'[]'::jsonb)
      FROM public.moderator_holds h JOIN public.idea_revisions held ON held.id=h.revision_id
      LEFT JOIN LATERAL (SELECT owner_id,sequence FROM public.moderator_escalation_transfers WHERE hold_id=h.id ORDER BY sequence DESC LIMIT 1) t ON true
      WHERE held.idea_id=i.id AND h.released_at IS NULL),
    'activeChangeRequests', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',c.id,'reason',c.reason,'requestedAt',c.created_at
      ) ORDER BY c.created_at,c.id),'[]'::jsonb)
      FROM public.moderator_change_requests c WHERE c.idea_id=i.id AND c.resolved_at IS NULL)
  ) INTO result
  FROM public.ideas i JOIN public.idea_revisions r ON r.idea_id=i.id
  LEFT JOIN public.revision_assessments a ON a.revision_id=r.id AND a.current
  LEFT JOIN public.review_gates g ON g.revision_id=r.id
  WHERE i.id=target_idea AND r.id=target_revision AND i.publication_state <> 'withdrawn'
    AND r.review_state NOT IN ('approved','rejected')
    AND NOT EXISTS (SELECT 1 FROM public.idea_revisions newer WHERE newer.idea_id=i.id AND newer.version>r.version);
  RETURN result;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.read_moderator_revision(text,text,uuid) FROM PUBLIC;
