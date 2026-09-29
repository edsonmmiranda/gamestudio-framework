# Gamificação e economia

Entrada: o que o jogador ganha, gasta e coleciona fora da partida, em que ritmo, e o que
muda quando quem joga é menor de idade.

Implementação: o [pacote de gamificação](../packages/gamification/README.md), com catálogo,
livro-razão, relógios, passe, missões, loja, amortecedores, sorte desligada, proteção de
menor e simulador de economia. Esta receita diz quando usar o pacote, como desenhar a
economia, o que verificar e o que derruba a conclusão.

## Quando aplicar

Aplique quando um jogo ganha metajogo: temporada, passe, missões, loja de cosméticos,
moeda, trilha ou coleção. Não aplique porque "todo jogo móvel tem". Adotar a máquina é
decisão do documento do jogo, e o documento pode recusar a máquina inteira: um jogo que
recusa loja e anúncio, e cuja campanha já é a trilha, não adota a máquina. O pacote não
decide monetização de nenhum jogo.

A base é um vocabulário fechado de primitivas (relógio, moeda, passe, missão, loja,
amortecedor, sorte, proteção de menor). Cada primitiva tem origem registrada por quem
a aplica, no material do próprio jogo; a receita não traz essa origem. Os números
abaixo ilustram o padrão e não viram meta de nenhum jogo.

## Como

**1. A gramática é uma só; o desenho está nas ligações.** Jogos de metajogo usam os
mesmos tipos de peça. O que muda entre eles é quantas peças há e como se ligam. Desenhe
a economia como três relógios encaixados, alimentados pela mesma partida:

- **o dia**, com virada, missões e teto diário;
- **a temporada**, que costuma durar de duas a treze semanas;
- **a coleção**, que nunca zera.

A partida paga tudo de uma vez: um mesmo evento pode contar em várias trilhas, e a tela
de resultado atualiza vários tipos de tarefa.

**2. O catálogo é dado, com hash por seção.** Ele é um pacote de seções, e a maior parte
dos números da gamificação fica no catálogo, não no código. Cada definição tem `id` e `version`, e as temporais têm
`validFrom`/`validTo`. O mesmo pacote vem do disco agora e de um servidor depois, com
substituição por seção. Mudou uma seção, muda o hash dela e o do pacote, e só esses.

**3. Toda entrada tem origem rotulada.** Registre cada movimento de moeda e de posse num livro-razão que só acrescenta. A
origem e o sumidouro vêm de vocabulário fechado, e o `txId` torna o lançamento
idempotente. Saldo é soma, nunca campo salvo. O livro é também a instrumentação da
economia.

**4. Cada relógio declara o que reinicia, o que acumula e o que vence.**

- **Dia:** vira numa hora UTC configurável. No exemplo do pacote são 09h UTC, 06h de
  Brasília: o dia não vira no meio da noite de jogo.
- **Aviso de fim:** a temporada avisa o fim com alguns dias de antecedência (cinco, no
  exemplo).
- **O que nunca zera:** a coleção e a carteira.
- **Moeda que vence:** declara isso na própria moeda. Some por um lançamento de
  vencimento, para o livro continuar sendo a verdade.

**5. O passe paga o jogo, não a espera.**

- **XP de partida:** com teto por partida e por dia, e nada para partida parada (abaixo
  de um limiar de duração ou de atividade).
- **Token de evento:** limitado ao que falta para fechar o passe.
- **Premium:** desbloqueável com moeda do jogo. A recompensa já alcançada entra
  sozinha, e nada se perde por não coletar.
- **Fim do passe:** não há cauda paga. O que sai de circulação volta pelo cofre (os
  visuais de temporadas antigas voltam por chaves).

**6. Missão é condição sobre evento.** A missão tem evento, jogo, condições sobre campos do próprio
evento ("metade de cima": `placement <= players × 0,5`), meta, ciclo e
recompensa. As missões do dia são as mesmas para todos e renovam na virada. A troca é
uma, grátis, por dia; a troca paga fica de fora.

**7. A loja é igual para todos.** O preço é em moeda do jogo e a rotação diária sai só
do catálogo e do dia. As ofertas têm janela e limite de compra. Oferta ou aviso por
segmento de gasto não existe no pacote, e o catálogo que declara `segment` é recusado.
Posse duplicada vira o que o catálogo diz, com reserva de duplicata por item.

**8. Amortecedores fazem parte do desenho.**

- **Consolo depois de derrotas seguidas:** partida contra bots, apaziguamento e consolo
  único por mundo.
- **Proteção de queda:** margem antes de cair de faixa, cartões de proteção e limite de
  queda de troféus.
- **Primeira vez separada do que se repete:** o que paga uma vez só soma um total que
  precisa ser comparado ao preço de um pacote. A régua do quanto o grátis rende precisa
  ficar explícita.

**9. Sorte é opcional e nasce desligada.** Quando ligada, obedece a quatro regras:

- usa só moeda ganha;
- mostra as chances, que somam 1;
- tem garantia escrita (número máximo de tiradas até o prêmio);
- reserva a duplicata.

Sorte é proibida para menor e para idade desconhecida (ECA Digital, art. 20).

**10. A proteção de menor já vem ligada.** O piso é o mais protetor entre os padrões de
mercado, não a média:

- a conta de criança não compra;
- o menor tem limite mensal de gasto;
- não há sorte para menor.

A idade desconhecida conta como menor, e a autodeclaração de adulto não basta. Vender
caixa paga sem porta de idade é o contraexemplo. A compra real existe só como adaptador desligado, e a segurança age antes
dele.

**11. A/B só de interface, com início e fim.** Bandeiras de teste têm data de início e de
fim. Pôr o A/B dentro da tabela de oferta fica de fora, porque preço, chance e
recompensa não entram em teste.

## O que verificar

- **Propriedades com sequências semeadas:**
  - o saldo nunca fica negativo, a soma dos lançamentos é o saldo e repetir o `txId`
    não muda nada;
  - o dia vira na hora UTC certa, também na virada de mês e de ano e em 29 de
    fevereiro;
  - a temporada zera só o que declara;
  - o XP nunca passa do último tier;
  - o token vale só o que falta;
  - o evento repetido não paga nem avança missão;
  - a rotação da loja é igual para todo jogador.
- **Segurança, uma prova por regra:**
  - a criança não compra, nem com catálogo e adaptador ligados;
  - a idade desconhecida conta como menor;
  - a sorte é recusada para menor;
  - a chance que não soma 1 é recusada na validação, com o campo no erro.
- **Simulação da temporada inteira pela API pública,** com o catálogo real e sem
  recurso injetado, como a receita de [mecânicas](mechanics.md) pede para economia.
  Faça-a com três personas (casual, regular e dedicado) e várias sementes. O critério
  julga o pior caso e o relatório mostra a mediana.
- **Controles negativos:**
  - um catálogo com fonte sem sumidouro e passe impossível precisa falhar;
  - apertar um critério precisa reprovar a mesma temporada;
  - um livro sem regras, com as mesmas operações, precisa ser pego pelo verificador.
- **A superfície:** a página mostra o bloqueio agindo em cada perfil de segurança e o
  livro-razão com as origens. O teste roda sem janela e sem roubar foco.

## O que invalida

- **Uma semente só:** no exemplo final, o casual fecha o passe grátis entre os dias 34 e
  42, conforme a semente. Numa versão anterior do catálogo, o intervalo ia de 37 a 46,
  cruzando o limite de 44. Com uma semente só, o mesmo catálogo passa ou reprova por
  sorte.
- **Perda para o teto contada depois do último tier:** a primeira versão do simulador
  mediu 13.503 XP perdidos pelo dedicado; o real era 1.809. XP depois do fim é sobra,
  não teto.
- **Sumidouro que existe mas satura:** a análise estática aprova, mas o dedicado compra
  tudo até o dia 20 e termina com cerca de 4 mil moedas paradas. A razão
  fonte/sumidouro (2,24) e o dia de saturação precisam aparecer junto do "tem
  sumidouro".
- **Persona não é jogador:** o simulador não mede diversão, retenção nem conversão. Ele
  mede o catálogo contra hábitos declarados.
- **Estado no cliente:** o estado no cliente pode ser adulterado. Placar ou concessão
  que exija prova pede servidor ([persistência](persistence.md)).
- **Compra real com o adaptador ligado:** ligar exige aferição de idade confiável,
  vínculo parental, estorno e revisão jurídica. Sem isso, a conclusão "é seguro" não
  vale.

## Caso e limites

O caso de referência é o catálogo de exemplo do pacote, jogado por um simulador. O
consumidor típico traz uma cópia gerada de `src/` com `SOURCE.json` e `--verify`, uma
página que mostra o bloqueio agindo e um QA sem janela que joga uma temporada
acelerada.

O catálogo de exemplo do pacote tem 56 dias e 30 tiers. Resultado no pior caso de oito
sementes, com a mediana entre parênteses:

| Persona | Fecha o grátis | Fecha o premium com moeda ganha | Fonte/sumidouro |
| --- | --- | --- | ---: |
| casual | dia 42 (36) | dia 42 | 1,14 |
| regular | dia 20 (17) | dia 20 | 1,41 |
| dedicado | dia 8 (8) | dia 8 | 2,24 |

Com teto diário, a distância entre personas vem dos dias ativos e das missões: o passe
que o casual fecha em 75% da temporada, o dedicado fecha em 14%. Encompridar o passe ou
aceitar esse desenho é decisão do jogo, depois de jogar.

Os valores vigentes de jogos publicados são remotos na maioria. O exemplo não usa
número de nenhum deles.
