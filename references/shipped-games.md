# O que os jogos publicados têm em comum

Regras de ofício comuns a jogos publicados de gêneros diferentes, do jogo de luta ao tower defense. Cada
regra diz quando aplicar, o que verificar e o que a invalida; `n` é o número de estúdios independentes em
que a prática foi confirmada. O caso, os números e as exceções de cada jogo ficam no workspace que fez a
leitura; aqui fica a regra.

Boa prática, aqui, é o que aparece em estúdios de gêneros diferentes **e** cuja remoção o próprio estudo
descreve como perda. Nenhuma exige o nome, a arte ou o modelo de negócio da referência. Nenhuma prova que
um jogo é bom: prova que os jogos que duraram são feitos assim.

## Máquina

**1. O relógio da regra é fixo e a tabela fala na unidade dele** (n = 11).
Aplicar em qualquer jogo com replay, rede, simulação de estudo ou tabela de tempos. Verificar: o passo num
lugar só, com unidade; a mesma sequência de entradas a 30, 60 e 144 fps dá o mesmo estado; toda constante
de tempo e velocidade diz em que unidade está; o desenho interpola e não decide. Invalida: jogo solo sem
replay pode viver de corrotinas e tempo acumulado, e paga com a falta de rollback e de simulação de estudo.
Armadilha: copiar um número sem o fator de conversão (um jogo estudado ficaria 2,6× mais rápido).
Receita: [ciclo de vida](../recipes/lifecycle.md) (invariância de taxa).

**2. Todo número de jogabilidade mora numa tabela com nome de campo, unidade e estado, fora do código** (n = 18).
Aplicar sempre. Verificar: um lint recusa literal numérico no núcleo fora de um bloco de motor declarado;
a folha de regras lista a origem de cada número (`observed`, `inferred`, `external_reference`, `assumed`);
constante que é fórmula do código fica na fórmula, com a fórmula citada. Invalida: o padrão de um campo
vazio e o que o código computa em runtime não estão na tabela; leia o código ou marque `unknown`.
Receita: [conteúdo](../recipes/content.md); contrato do número em
[adaptação de referências](reference-adaptation.md#4-quando-o-workspace-declara-referências).

**3. Regra e aparência moram em contêineres separados; skin não muda número** (n = 6).
Aplicar em qualquer jogo com mais de uma aparência por entidade. Verificar: trocar a aparência não muda
campo lido pela simulação; a caixa de acerto é a mesma para toda skin; a tabela de regra não tem coluna de
arte. Invalida: aparência que vende número (trajes que trocam golpe, kart com vantagem de pista) é decisão
de produto e deve ser declarada como tal; o jogador a percebe como pagar para vencer.
Contrato: [design system do jogo](game-design-system.md).

**4. A lógica fala com o visual por fila de eventos; o visual não escreve no estado** (n = 5).
Aplicar quando há rede, replay, rollback, comparador ou bancada. Verificar: silenciar ou acelerar o desenho
não muda a partida; som e efeito nascem como eventos com carimbo de tempo, desfazíveis quando há rollback;
o registro da simulação é o oráculo de determinismo (mesma semente, mesmo texto). Invalida: jogo solo sem
replay pode misturar, e perde reconexão e simulação de estudo.
Receita: [arquitetura](../recipes/architecture.md) (prévias: renderização não é execução de eventos).

**5. Autoridade, tick e arma são uma decisão só** (n = 9).
Aplicar antes de escolher netcode ou arma. Verificar: o brief diz quem decide o acerto (servidor, lockstep,
rollback, cliente) e o que isso proíbe: 20 Hz no servidor empurra para armas de área e cone; rollback exige
tudo inteiro e apresentação desfazível; lockstep exige ponto fixo em tudo e deixa o estado inteiro em cada
aparelho, então a névoa é regra e o segredo é do cliente; servidor com semente compartilhada deixa o cliente
prever o furo sem decidir o acerto. Invalida: jogo local sem rede é cliente autoritativo, dito no brief.
Receita: [rede](../recipes/network.md).

**6. O modo é uma linha de dados sobre o mesmo motor** (n = 9).
Aplicar em qualquer jogo com mais de um modo. Verificar: modo novo nasce sem tocar o núcleo (regra de fim,
elenco, mapa, números, bandeiras); a vitória é lida por id, nunca por `if modo == …`; toda partida do modo
termina pela regra dele; elenco, som e mapa são compartilhados entre modos. Invalida: modo que troca o verbo
é outro jogo; modo com som próprio multiplica o custo por modo.
Receita: [mecânicas](../recipes/mechanics.md).

**7. Conteúdo novo nasce de template e primitivas** (n = 8).
Aplicar em toda família com mais de três itens. Verificar: o próximo item nasce editando dados, com o custo
cronometrado; a receita diz o que o item pode e não pode variar; item inválido falha de forma legível.
Invalida: primitivas demais viram uma linguagem sem limite; item que exige primitiva nova é código de
verdade e se faz como tal. Receita: [conteúdo](../recipes/content.md).

**8. O mapa é dado; colisão, navegação, nascimento e modo derivam dele; andar e ver são camadas distintas** (n = 8).
Aplicar em qualquer jogo com mais de um mapa. Verificar: mapa novo entra sem editar código de colisão,
navegação ou nascimento; o artista sabe que trocar uma peça ou textura muda a física; a máscara de andar não
é a de ver. Invalida: mapa gerado deriva da semente e da regra. Armadilha: classificar colisão só pela flag
(bit não é papel) inventa paredes e chão; a classificação vem da geometria conferida por um gate de física.

## Partida e retorno

**9. O tempo do golpe mora no clipe; o som é evento do clipe** (n = 7).
Aplicar em toda ação com antecipação, impacto e recuperação. Verificar: cast, impacto e som são quadros e
eventos do asset de animação, não constantes paralelas; mudar o clipe muda a regra; o teste compara o
instante do som com o do dano. Invalida: a consequência (acerto, dano, morte) fica na regra, não no clipe;
clipe sem evento toca no início e fica marcado como inferido.
Receitas: [feel](../recipes/feel.md), [animação 2D](../recipes/animation-2d.md), [áudio](../recipes/audio.md).

**10. O som é evento nomeado com mix em banco; a música é o estado da partida; a voz tem portão** (n = 9).
Aplicar em qualquer jogo com mais de dez sons. Verificar: cada som tem nome de evento ligado à ação ou ao
estado, e o mix mora num banco ou tabela, não no código; a trilha muda pela fase (vivos, última volta, último
minuto), não por golpe; um jogador de olhos fechados diz a fase; o som de impacto escala com o valor do
acerto. Invalida: turno lento pode viver de silêncio e ambiente. Receita: [áudio](../recipes/audio.md).

**11. O retorno tem dois relógios e degraus de intensidade** (n = 5).
Aplicar na ação central. Verificar: o sinal imediato (≤ 0,1 s: hit stop, número, som) e o marco
(0,6–2 s: placar, combo, posição) têm relógios separados; o dano médio e o forte têm limiares nomeados na
tela e no som. Invalida: tela que mente (dano sorteado só para a exibição) é alegação, não retorno.
Receitas: [feel](../recipes/feel.md), [juice](../commands/juice.md).

**12. O bot é perfil em dados no corpo do jogador, com percepção limitada como a do humano** (n = 8).
Aplicar em todo bot. Verificar: bot e jogador passam pelo mesmo corpo e pelas mesmas regras; o perfil
(reação, erro de mira, agressividade) é dado, e a dificuldade muda o perfil, não a regra; visão, audição e
mato limitam o bot como limitam a pessoa; o placar diz que é bot. Invalida: apresentar bot como pessoa
(mortes encenadas, grupo falso) é recusa do estúdio.
Referência: [aprendizados](learning.md#ia-com-percepção-e-decisão-em-cadências-diferentes).

**13. Sala nunca vazia; toda partida termina pela regra, com jogo antes, e volta ao lobby** (n = 7).
Aplicar em todo multiplayer. Verificar: sala com um jogador começa e termina (bots completam); tirar um
jogador no meio não trava a partida (IA assume, rendição por voto); o gate exige evento de jogo antes do
fim e lista cada empate com a regra que o deu. Invalida: sofá com amigos, a sala vazia é do anfitrião.
Receita: [ciclo de vida](../recipes/lifecycle.md).

## Desenho

**14. O líder tem freio e quem está atrás tem porta** (n = 7).
Aplicar em toda partida com mais de um minuto. Verificar: o freio (teto por abate, bônus de derrota
crescente, freio de ouro, nenhum golpe acima de uma fração da vida) e a porta (item por posição, vazar paga,
reparo por necessidade) têm número nomeado na regra do modo ou na economia; um lote de partidas com e sem
eles muda a taxa de vitória do líder; o líder ainda ganha. Invalida: eliminação por um toque tem porta
espacial, não de vida; cooperativo contra ondas tem o freio na onda.

**15. O verbo tem orçamento que o próprio verbo repõe** (n = 6).
Aplicar na ação central. Verificar: o recurso tem teto e leitura na tela; a ação que o gasta é a mesma que
o repõe, ou uma ação irmã com custo; quem só espera não fica em vantagem sobre quem age. Invalida: recarga
por relógio serve a habilidade rara, não ao verbo central.

**16. Segurar troca tempo por poder, e o segurar denuncia** (n = 5).
Aplicar quando há carga, canal ou drift. Verificar: o segurar tem teto de tempo e um sinal que o outro lado
percebe (corpo lento, som por nível, brilho); segurar o máximo não é sempre a jogada ótima. Invalida: carga
silenciosa é vantagem escondida; em jogo de um toque, o segurar é o instante, não a força.

**17. Degrau legível para o que se conta; contínuo para o que se sente** (n = 5).
Aplicar em velocidade, estado de corpo, raridade, nível. Verificar: um jogador novo diz quantos degraus há
e o que muda entre eles; o degrau tem sinal no jogo, não só no código. Invalida: gravidade, arrasto, atrito
e câmera continuam contínuos; dez degraus voltam a ser rampa.

**18. Informação antes do compromisso** (n ≥ 8).
Verificar: a próxima leva, o item que caça o líder, a peça que vai cair e o objetivo neutro avisam antes;
a porta informa o tipo, não o conteúdo. Invalida: informação total transforma escolha em otimização seca.

## O que divergiu, e é decisão

Autoridade (servidor 20 Hz, semente compartilhada, lockstep, rollback, P2P, cliente), legibilidade do número
(tabela aberta, cifrada, selada, no código), tick por gênero (62,5 Hz na luta, 20 Hz no battle royale
móvel, 30–33 Hz no tower defense) e o tamanho do saguão (jogo ao vivo com relógios empilhados contra jogo
pago sem relógio). Nenhuma delas é regra de partida; cada uma é escolha de plataforma e de negócio que
arrasta as regras acima. Declare a escolha no brief antes de copiar uma prática que dependa dela.

Origem: leitura comparada de jogos publicados, consolidada em setembro de 2026. Os números de cada jogo e
as exceções nomeadas ficam no workspace que fez a leitura; revisão futura incorpora contraprovas aqui, pelo
[procedimento](learning.md).
