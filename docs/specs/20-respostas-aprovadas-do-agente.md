# Spec 20 — Respostas aprovadas do agente

## Contrato

O Conversador classifica a necessidade do lead, mas não redige a mensagem. Sua única saída de fala
é `send_message({ reply_id })`. O runtime resolve esse identificador contra
`ai_approved_replies`, sempre filtrando pela organização do job e por uma destas condições:

- `agent_id is null`: resposta global da organização, disponível a todos os seus agentes;
- `agent_id = agente publicado`: resposta exclusiva daquele agente.

O corpo nunca vem do modelo. ID inexistente, inativo, de outra organização ou de outro agente é
recusado antes da cadeia de envio. O texto resolvido ainda atravessa opt-out, LGPD, pacing,
promessas e casos humanos. O gate de vocabulário interno não tenta reescrever texto humano já
aprovado.

## Falta de resposta

Biblioteca vazia não reabre texto livre. Antes de chamar o modelo, o runtime faz handoff
determinístico, silencia o bot e cria um item crítico na Central de avisos. A ausência também
aparece na tela do agente. Se a janela do canal oficial estiver fechada, o turno também segue para
um humano: o Conversador não recebe `send_template` como rota alternativa. O modelo não pode usar
texto solto: o runtime já o descarta e a única ferramenta de fala não possui argumento de corpo.

## Living System Checklist

- Entrada: admin cria e aprova o texto na aba Respostas do editor do agente.
- Saida: `loadApprovedReplies()` alimenta o turno e `send_message` alimenta a cadeia before-send.
- Registro: create/update/delete em `api_audit_log`; outbound leva `approved_reply_id` no metadata.
- Tela/porta: IA > Agentes > agente > Respostas.
- Anti-morte: sem opção, o agente deve encaminhar ao humano; nunca improvisa.
- Configuração: a mesma aba permite criar, editar, ativar, desativar e excluir.
- Continuidade: handoff existente leva checkpoint e contexto da conversa.
- Laço: o recibo por `approved_reply_id` permite medir uso e revisar textos que não resolvem.

## Destino arquitetural

**Núcleo.** Mesmo que nenhuma organização cadastre uma resposta, o comportamento comum do
Conversador muda: ele deixa de poder redigir e encaminha a conversa para uma pessoa. Portanto,
esta não é uma capacidade opcional que possa viver isolada numa extensão.
