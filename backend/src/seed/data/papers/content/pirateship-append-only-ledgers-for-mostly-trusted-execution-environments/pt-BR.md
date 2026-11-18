---
title: "Pirateship: ledgers append-only para ambientes de execução (quase) confiáveis"
summary: O Pirateship embute um protocolo de auditoria tolerante a falhas bizantinas dentro de um protocolo de consenso tolerante a falhas de parada, sem mensagens extras, de modo que um ledger que roda em ambientes de execução confiáveis confirma na velocidade de sempre enquanto comprometimentos raros dos TEEs são detectados e reconciliados numa janela limitada, sob um modelo de falhas que trata plataformas correlacionadas como a unidade de comprometimento.
researchArea: Sistemas distribuídos
keywords: consenso, ambientes de execução confiáveis, tolerância a falhas bizantinas, ledger append-only, auditoria, tolerância a falhas de plataforma, troca de visão
version: 1.0
updatedAt: 2026-11-18
---

## Visão geral

Ledgers à prova de adulteração guardam pequenas quantidades de estado muito sensível, como chaves secretas ou declarações de releases de software, e servem de raiz de confiança de aplicações maiores. A indústria e a academia hoje os constroem em camadas: um protocolo de consenso tolerante a falhas de parada (CFT) como o Raft replica o log, e cada nó roda dentro de um ambiente de execução confiável (TEE) em hardware, como AMD SEV-SNP ou Intel TDX, em que se confia para que o nó siga o protocolo e assim exclua comportamento bizantino. Essa confiança é barata, já que o CFT precisa de apenas 2c+1 nós e uma fase de votação.

Os autores, da UC Berkeley, do IST Lisboa e da Microsoft Azure Research, apontam que essa confiança é um ponto único de falha. Atacantes já extraíram segredos de todos os principais TEEs, vulnerabilidades continuam aparecendo, e uma única falha pode comprometer todos os TEEs do mesmo tipo numa região de nuvem, então um comprometimento é raro mas catastrófico: o atacante pode bifurcar o log inteiro sem ser detectado. A escolha oposta, não confiar em nenhum TEE e rodar um protocolo tolerante a falhas bizantinas (BFT), custa mais réplicas (3f+1), mais fases e mais latência.

Este artigo do SOSP 2026 (Praga) toma um caminho do meio que chama de confiança cautelosa: confirmar na velocidade do CFT e auditar em segundo plano com garantias de BFT, de modo que um comprometimento seja detectado e o log reconciliado sem sobrecarregar os clientes.

Termos para não confundir: transação confirmada (committed) é durável enquanto os TEEs não forem comprometidos, transação auditada (audited) nunca pode ser desfeita até um número declarado de comprometimentos de plataforma, equivocação é um nó enviar mensagens conflitantes a pares diferentes, e plataforma é um grupo de nós que compartilham um domínio de falha correlacionado (mesmo tipo de TEE, operador ou região).

Vale conhecer antes: Raft e interseção de quóruns. O [Raft](/papers/raft-understandable-consensus-algorithm) é o protocolo CFT que o artigo toma como ponto de partida e como linha de base. O [Autobahn](/papers/autobahn-seamless-high-speed-bft) é o protocolo BFT de ponta com que o desempenho de auditoria é comparado.

## Contribuição

- **Tolerância a falhas de plataforma (PFT).** Um modelo de falhas com nós agrupados em plataformas, em que as quedas são independentes por nó mas uma vulnerabilidade de TEE compromete uma plataforma inteira. Ele separa segurança (safety) de vivacidade (liveness) e dá a cada uma sua própria tolerância: seguro até um número de comprometimentos de plataforma (`f_safe` nós no pior caso), vivo até `c` quedas e um número de comprometimentos de plataforma (`f_live`). O consenso exige `N >= 2(c + f_live) + f_safe + 1` nós. Sem falhas bizantinas isso é o limite do CFT, `2c+1`, e com `u = f_safe = f` é o limite do BFT, `3f+1`, e nunca passa do limite do BFT. O Pirateship é sempre configurado para continuar seguro e pode abrir mão da vivacidade.
- **Dois níveis de confirmação.** Um lote é confirmado (commit) quando uma maioria (`floor(N/2)+1`) o guardou na mesma visão, sem assinaturas, como nos ledgers com TEE de hoje. Ele é auditado depois de um quórum de `N-u` votos assinados, que garante não equivocação, mais um segundo quórum desses sobre o primeiro, que garante que a decisão sobrevive às trocas de visão (auditoria lenta), ou depois de votos assinados das `N` réplicas (auditoria rápida, uma única ida e volta). Uma transação auditada nunca pode ser desfeita, uma apenas confirmada pode, se plataformas forem comprometidas.
- **Sem mensagens extras.** Os lotes são encadeados por hash, então um voto num lote é um voto em todos os seus ancestrais. Votos tardios, ou votos em lotes posteriores, promovem de forma assíncrona um quórum de commit a quórum de auditoria. O pipelining coloca a segunda fase do BFT sobre o lote seguinte, de modo que a auditoria nunca fica atrás do índice de commit por mais que um limite constante. O líder assina só a cada `s` lotes, e auditar um lote assinado audita seus ancestrais.
- **Estabilização de visão.** Depois dos passos usuais da troca de visão, um novo líder propõe um lote assinado em branco e espera um quórum de auditoria sobre ele antes de acrescentar qualquer outra coisa. Isso faz os ramos confirmados mas não auditados sobreviverem às trocas de líder quando ninguém é malicioso, embora os quóruns de commit sejam menores e sem assinatura. Uma seleção de ramo em quatro regras (maior QC de auditoria, candidatos da via rápida, depois maior visão e número de sequência) preserva sempre os ramos auditados e os confirmados na ausência de réplicas maliciosas.
- **Recibos e uma API de auditoria.** Os recibos de commit trazem uma prova de inclusão de Merkle, os de auditoria acrescentam os certificados de quórum de auditoria e um trecho curto da cadeia de hashes, de modo que clientes possam entregar evidência a terceiros. O cliente escolhe, por transação ou por período, se espera a auditoria.
- **Correção e tamanho.** Os autores provam o protocolo correto num apêndice e dão uma especificação em TLA+. A implementação tem cerca de 8 mil linhas de Rust (Tokio, Protobuf, Ed25519 e SHA-512).

## Metodologia

O ambiente é o Azure: máquinas DC16ads_v5 (AMD SEV-SNP), DC16eds_v5 (Intel TDX) e D16ads_v5 (sem TEE) de 16 núcleos e 64 GB de memória, até cinco clientes D8ds_v5 e, por padrão, sete nós (`u = f_safe = 2`) numa região (East US) com SEV-SNP e ping de 0,6 ms, lotes de 1000, payloads de 512 bytes e assinatura a cada 10 lotes. As linhas de base, reimplementadas na base de código do Pirateship exceto o Autobahn (que usa o código aberto dele), são `signed_raft` (Raft com encadeamento por hash e assinaturas periódicas, como o CCF da Microsoft), `engraft` (Raft com um commit de duas fases extra contra rollback de disco), `hotstuff`, `autobahn` e `peer_review` (um protocolo de responsabilização com testemunhas assinadas). O desempenho de commit é comparado com os dois primeiros e o de auditoria com os protocolos BFT, e os resultados do Autobahn e do PeerReview foram validados com seus autores.

Outros experimentos implantam até cinco plataformas, cada uma um par (TEE, região) em várias regiões do Azure, em três configurações; medem o custo do TEE e o intervalo de assinatura; injetam ataques de omissão (nós que nunca respondem) e um ataque de comissão (um líder que equivoca para duas partições); e constroem cinco aplicações: um armazenamento chave-valor versionado (YCSB, 300 mil objetos), uma aplicação bancária, um serviço de transparência de chaves, um serviço de recuperação de chave secreta no estilo do Signal e um serviço de transparência de código comparado com um sobre o CCF.

## Resultados

Estes são os resultados reportados pelos autores.

- **Desempenho de commit.** Com sete nós e assinatura a cada 10 lotes, o Pirateship chega a um pico de 345 mil transações por segundo, limitado pela banda do líder. O `signed_raft` com apenas cinco nós chega a 520 mil, o que faz da diferença de 35% o preço do fator de replicação maior necessário para a auditoria, e o Pirateship alcança 87% do `signed_raft` com sete nós. Ele é 1,9 vez mais rápido que o `engraft`, 46% mais rápido que o `hotstuff` (20% assinando cada lote) e, assinando cada lote, 39% acima do `peer_review`.
- **Desempenho de auditoria.** O Pirateship audita com 88,6% da vazão do Autobahn e latência 15% menor, e os autores dizem que a confiança cautelosa nos TEEs dá latência de commit até 2,6 vezes menor que um protocolo que não confia em nenhum.
- **Plataformas.** Tolerando um comprometimento de plataforma para segurança, uma configuração com sete nós em quatro plataformas (2,2,2,1) tem latência de commit 51% e 59% menor que as outras duas, porque um commit precisa de votos de apenas duas regiões em vez de três. A vazão de pico cai 24% quando entra um enlace de 1,17 Gbps para a Europa Ocidental.
- **Custos.** Rodar dentro do Intel TDX ou do AMD SEV-SNP reduz a vazão em 11 a 15%. Assinar a cada 10 lotes em vez de a cada lote aumenta a vazão 1,24 vez e a latência de auditoria 1,84 vez.
- **Ataques.** Quando nós retêm os votos de que uma auditoria rápida precisa, as auditorias lentas ficam 1,9 vez mais lentas, sem perda de vazão. Com um líder que equivoca, os commits continuam por cerca de 2,4 segundos enquanto a vazão de auditoria cai a zero, os seguidores expiram depois de 4 segundos, o novo líder escolhe seu ramo por volta de 35 segundos, a réplica no ramo conflitante faz rollback, e o regime estável volta por volta de 40 segundos.
- **Aplicações.** Transferências bancárias auditadas levam 1,7 vez o tempo das apenas confirmadas. Um serviço de transparência de chaves que passa a esperar auditorias depois de uma vulnerabilidade de TEE vê o tempo de resposta saltar cerca de 1,7 vez e voltar ao normal depois. O serviço de recuperação de chaves retém um usuário em rajada, cuja latência mediana fica 20 vezes maior, enquanto um usuário com um palpite por segundo nunca é retido. No serviço de transparência de código, os recibos de auditoria na via rápida têm latência comparável à dos recibos de commit, e os autores relatam que as garantias mais fortes não custam desempenho frente a um serviço baseado no CCF.

## Análise crítica

O artigo declara vários limites por conta própria.

- **O agrupamento em plataformas é uma crença.** Se duas plataformas falham de forma independente depende do julgamento do operador, e uma vulnerabilidade compartilhada desconhecida pode ultrapassar `f_safe`, como em qualquer limite de falhas. A reconfiguração permite mudar o agrupamento conforme as crenças mudam.
- **Seguro, não necessariamente vivo.** O Pirateship é configurado para segurança, e vivacidade sob comprometimento custa dois nós extras por nó comprometido tolerado. Os autores argumentam que hosts maliciosos já podem travar a vivacidade, então o custo muitas vezes não vale a pena.
- **Sem atribuição de culpa.** Ele detecta e reconcilia a divergência, mas não identifica os nós defeituosos, o que deixa para trabalhos de responsabilização como o PeerReview, que chama de complementares.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A reconciliação é empurrada para as aplicações.** Uma transação confirmada pode ser desfeita depois de um ataque, então aplicações que agem no commit precisam desfazer efeitos, como fazem a camada versionada do chave-valor e o contador de palpites de senha. A afirmação de que a auditoria não impõe ônus aos clientes vale para clientes que nunca esperam a auditoria e nunca veem um rollback, e a latência 1,7 vez maior das operações auditadas é o preço para os demais.
- **Os ataques são injetados.** O teste de equivocação mostra o mecanismo funcionando num líder roteirizado, e as vulnerabilidades não são exploits reais de TEE. O limite de quanto a auditoria fica atrás do commit é um número constante de lotes, mas a janela de exposição em segundos sob carga não é reportada, e um adversário que se adapte ao protocolo (por exemplo, cronometrando ataques em torno de trocas de visão) não é testado.
- **A comparação depende das portas feitas pelos autores.** Quatro das cinco linhas de base foram reimplementadas na base de código do Pirateship, o que mantém a comparação controlada mas deixa em aberto como se sairiam um sistema de produção como o CCF ou o engraft original. A diferença de 35% para um `signed_raft` de cinco nós é real: auditar exige mais réplicas.
- **Uma nuvem e um formato de implantação.** Tudo roda no Azure, com SEV-SNP e TDX e até cinco plataformas. Um cenário realmente multinuvem, em que as plataformas diferem em operador e não só em tipo de TEE, é argumentado mas não medido, e a banda, não o protocolo, limita a vazão em vários resultados.
- **A parte formal é difícil de conferir.** Uma prova e uma especificação em TLA+ estão no apêndice, e o texto principal só as resume, então o leitor não consegue verificar o argumento da estabilização de visão pelo corpo do artigo.

## Pesquisas futuras

- Identificar a plataforma comprometida depois de uma divergência, combinando a PFT com técnicas de responsabilização.
- Uma avaliação realmente multinuvem, com independência de plataformas medida, e reconfiguração automática quando uma nova vulnerabilidade muda quais plataformas contam como independentes.
- Padrões de aplicação para o rollback de transações confirmadas, e formas mais baratas de deixar o cliente escolher commit ou auditoria por requisição.
- Repartir a banda do líder, já que ela limita a vazão, por exemplo com proponentes paralelos como nos protocolos BFT baseados em DAG.
