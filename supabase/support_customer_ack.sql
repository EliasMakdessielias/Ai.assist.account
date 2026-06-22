-- Kundbekräftelse vid nytt/eskalerat supportärende.
-- Tillämpad via migration support_ticket_customer_ack.
-- create_support_ticket skickar en bekräftelse (in-app + e-post enligt preferenser) till
-- ärendeskaparen utöver den befintliga support_ticket_created-notisen till supportstaben.

-- Mallar (re-run-säkert: ersätt ev. befintliga för detta event).
delete from public.notification_templates where event_type = 'support_ticket_customer_ack';
insert into public.notification_templates (event_type, channel, lang, subject, body, required_vars, is_active) values
('support_ticket_customer_ack', 'email', 'sv-SE',
 'Vi har tagit emot ditt ärende',
 'Hej!' || chr(10) || chr(10) ||
 'Tack – vi har tagit emot ditt supportärende "{{subject}}". Vårt supportteam återkommer så snart som möjligt.' || chr(10) || chr(10) ||
 'Du kan följa och svara på ärendet här:' || chr(10) || '{{actionUrl}}' || chr(10) || chr(10) ||
 'Vänliga hälsningar' || chr(10) || 'BokPilot Support',
 array['subject','actionUrl'], true),
('support_ticket_customer_ack', 'in_app', 'sv-SE',
 'Ärende mottaget: {{subject}}',
 'Tack! Vi har tagit emot ditt ärende och återkommer så snart vi kan.',
 array[]::text[], true);

-- create_support_ticket: oförändrad logik + en kundbekräftelse till ärendeskaparen (array[v_uid]).
-- Se migration support_ticket_customer_ack för full funktionsdefinition. Tillagd rad:
--   perform public.notify_event(p_company_id, 'support_ticket_customer_ack',
--     jsonb_build_object('subject',left(p_subject,200),'actionUrl','https://app.bokpilot.se/support'),
--     'support_ticket', v_id, '/support', array[v_uid], v_uid, 'normal', 'ack:'||v_id::text);
