# Aprendizados que atravessam jogos

O framework guarda conhecimento e ferramentas que podem servir a outros jogos.
O workspace guarda escolhas do criador, configuração, estado de cada jogo e provas
das aplicações. Um histórico local pode repetir a descrição de um caso; a regra
reutilizável tem uma fonte canônica no framework.

## Extrair no momento da descoberta

Quando uma rodada produz um método, falha recorrente ou correção transferível:

1. Identifique a fonte e a condição que tornou o problema observável. Preserve a
   evidência original no jogo, com versão, cenário, resultado e limitações.
2. Separe a escolha autoral da relação técnica. Uma preferência por gravação não é
   um requisito universal de áudio; validar licença e interrupção é reutilizável.
3. Encontre o consumidor canônico do aprendizado: receita, package da plataforma,
   checklist ou ferramenta existente. Adapte esse conteúdo; não crie uma segunda
   implementação nem um arquivo por incidente quando há lugar adequado.
4. Escreva **quando aplicar, o que verificar, o que invalida a conclusão e os limites**.
   Números locais ilustram o caso; não viram promessa de ganho em outra máquina.
5. Ligue a prova local à regra extraída. Na retomada, consulte a versão central;
   registre novas exceções ou contraprovas no mesmo lugar.

Se o conhecimento for uma hipótese, registre como hipótese com sua prova pendente.
Não promover uma hipótese a técnica comprovada e não deixar uma descoberta utilizável
presa ao laboratório. A execução desta revisão cabe ao agente: o scanner localiza
documentos, mas não decide sozinho se uma afirmação é transferível ou verdadeira.

## IA com percepção e decisão em cadências diferentes

Ao separar escolha de alvo, percepção, rota e disparo, uma amostra de visibilidade
precisa pertencer à identidade do alvo atual. Trocar de rival entre duas amostras
não autoriza usar a posição, a reação ou a visão do anterior. Antes do tiro, conferir
identidade, visibilidade, reação, linha livre e orientação do corpo; seguir um caminho
não deve sobrescrever a direção da mira. Exercitar troca de alvo durante uma rajada.

Para recuperar rotas, medir deslocamento acumulado em uma janela de tempo, nunca
um limiar fixo por quadro. Reter uma meta navegável até chegada/invalidação, limitar
quanto uma busca pendente adia o diagnóstico e não zerar progresso a cada decisão.
Ao fugir de uma área em fechamento, a margem da meta deve superar a margem que
dispara a fuga mais a tolerância de chegada, evitando reescolher o mesmo ponto na borda.

Caso: adaptação MineNite → Última Página, 27/9/2026; provas locais em
`games/distrito-rabisco/production/evidence/ultima-pagina-minenite-20260927/`.
Comparar cenários em movimento e registrar tarefas concorrentes: contagem de tiros
ou tempo de quadro em mapas/RNG diferentes não constitui A/B causal nem aceite de diversão.

## Extrair de históricos de agentes

Um avaliador pode ordenar sessões para revisão, mas sua nota não escreve nem valida
uma lição. Registre origem, versão e eventos que sustentam condição, diagnóstico,
correção e verificação; separe relato do agente de resultado observado. Sucesso da
tarefa não compensa ausência de evidência, e falha da tarefa inteira não apaga uma
correção local demonstrada. Prefira filas de revisão a descarte por nota quando a
cobertura do avaliador ainda não foi medida.

Recortes de histórico omitem fatos. Preserve referências para recuperar a correção
e os eventos adjacentes; não trate a ausência na amostra como ausência na sessão.
Confira o projeto de origem antes de atribuir memória ao destino. Uma orientação
aprovada deve atualizar o consumidor existente, com condição de invalidação; se
for exportada, a atualização ou retirada precisa alcançar os arquivos consumidores.

Caso e limites: piloto de 24 históricos do laboratório em
`docs/registros/Beacon e Jev — piloto de triagem de sessões.md`, 22/09/2026.
A comparação mede triagem contra um revisor agente, não aprendizado autônomo,
economia de execução nem ganho posterior entre ferramentas.

## Destino do conteúdo

| Conteúdo | Fonte canônica |
| --- | --- |
| Ciclo de criação e critérios de decisão | [Workflow](creative-workflow.md), [processo](process.md) |
| Diagnóstico, comparação e custo de uma técnica | [Performance](../recipes/performance.md) |
| Carregador, renderizador ou serialização de uma plataforma | Package de [web](../packs/platforms/web.md) ou [Unity](../packs/platforms/unity.md), conforme o caso |
| Exportação, animação, buffers e proveniência | [Conteúdo](../recipes/content.md), [áudio](../recipes/audio.md) |
| Gestão de módulos e extração de repositórios | [Ferramentas de workspace](workspace-binding.md#módulos) |
| Preferência artística, fornecedor excluído, endereço de publicação | AGENTS/configuração do workspace ou documento do jogo |
| Medição bruta, captura, decisão aplicada e histórico | Jogo ou laboratório que produziu a prova |
| Segundo cérebro (estudos, padrões, grafo com evidência) | [Kit replicável](../assets/cerebro/Como%20replicar.md); o caso do estúdio permanece no vault do laboratório |
| Prática comum aos jogos publicados (relógio, tabela, modo como dado, bot, freio, som) | [O que os jogos publicados têm em comum](shipped-games.md); o caso de cada jogo fica no estudo e nos padrões do vault |

Código específico permanece com seus consumidores. Para compartilhar uma implementação,
confirme o contrato comum e separe parâmetros de identidade, caminhos e políticas.
Uma técnica reutilizável pode viver como orientação em um package sem transformar
o código de um jogo inteiro numa biblioteca. O harness continua fino.

## Jogos publicados lidos pela fonte

Vinte e cinco jogos lidos pela fonte primária em setembro de 2026 convergiram, sem combinar, em dezoito
práticas de máquina, partida e desenho: relógio fixo com tabelas na unidade dele, número em tabela com nome,
regra separada da aparência, modo e mapa como dados, golpe no clipe, música como estado, bot no corpo do
jogador, freio para o líder e porta para quem está atrás. Cada uma com quando aplicar, verificar e invalidar
em [O que os jogos publicados têm em comum](shipped-games.md). O `context` a inclui nos focos `create`,
`mechanics` e `content`.

## Aprendizados incorporados nesta extração

O ciclo de criação, métodos de medição, invalidação de sombras, preservação de
identidade de instâncias, paridade entre renderizadores, exportação/serialização,
cadência de animação e custo de áudio foram extraídos dos registros de aplicações
do laboratório de setembro de 2026. As receitas e os packages acima contêm as
condições generalizadas; resultados e tentativas descartadas permanecem nos registros
originais. A [origem](sources.md#aprendizados-de-aplicações) delimita essa evidência.
