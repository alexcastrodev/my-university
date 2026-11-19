---
title: "Consistência eventual"
summary: Werner Vogels, então CTO da Amazon, escreve um ensaio curto sobre o trade-off entre consistência e disponibilidade em armazenamento replicado. Ele apresenta os modelos de consistência do ponto de vista do cliente (causal, read-your-writes, de sessão, leituras e escritas monotônicas), a configuração N, W, R com a regra W+R > N e a janela de inconsistência, usando o Dynamo como o sistema que expõe esses parâmetros às aplicações.
researchArea: Sistemas distribuídos
keywords: consistência eventual, teorema CAP, quóruns, replicação, consistência de sessão, janela de inconsistência, disponibilidade
version: 1.0
updatedAt: 2026-11-19
---

## Visão geral

Este é um artigo da seção practice da Communications of the ACM (volume 52, número 1, janeiro de 2009, páginas 40 a 44), com um único autor. É a versão revisada de um post de blog de 2007, publicada também na ACM Queue em outubro de 2008. É um ensaio, não um artigo de pesquisa: não há experimento, avaliação de sistema nem prova. A frase de abertura resume a tese: construir sistemas distribuídos confiáveis em escala mundial exige trocas entre consistência e disponibilidade.

O texto parte dos serviços de infraestrutura da Amazon (S3, SimpleDB e EC2 são citados, apenas como a base da sua computação em nuvem) e de uma observação: com trilhões de requisições, eventos raros acontecem com certeza, então a replicação é usada em todo lugar e não consegue ser perfeitamente transparente. A parte histórica cita "Notes on Distributed Databases", de Lindsay, para o fim dos anos 1970, quando os sistemas preferiam falhar por inteiro a quebrar a transparência de distribuição, e a palestra de Brewer no PODC 2000 para o teorema CAP. A confirmação formal é atribuída a Gilbert e Lynch, tratados em [A conjectura de Brewer e a viabilidade de serviços web consistentes, disponíveis e tolerantes a partições](/papers/brewers-conjecture-cap-feasibility-web-services).

Vale conhecer antes: replicação, quóruns e a diferença entre o C do CAP e o C do ACID, que o próprio artigo separa em um parágrafo. O sistema com que ele termina é descrito em [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store).

## Contribuição

- **O CAP como motivação.** Entre consistência de dados, disponibilidade e tolerância a partições, só duas podem existir ao mesmo tempo. Como partições são inevitáveis em sistemas grandes, a escolha é entre relaxar a consistência para continuar disponível e priorizar a consistência aceitando indisponibilidade.
- **Modelos de consistência no cliente.** Com um sistema de armazenamento e os processos A, B e C, o artigo define consistência forte, fraca e eventual, e cinco variações do modelo eventual: causal, read-your-writes, de sessão, leitura monotônica e escrita monotônica.
- **A janela de inconsistência.** O período entre uma atualização e o momento em que todo observador passa a ter garantia de vê-la. Sem falhas, seu tamanho máximo depende de atrasos de comunicação, da carga do sistema e do número de réplicas.
- **Terminologia do lado do servidor.** N é o número de réplicas, W o número que precisa confirmar uma escrita e R o número consultado em uma leitura. Se W+R > N, os conjuntos de leitura e de escrita se sobrepõem e a consistência forte pode ser garantida. Se W+R <= N, a consistência é fraca ou eventual.
- **Um guia de ajuste.** R=1 com N=W otimiza leituras, W=1 com R=N otimiza escritas, e N=3 com W=2 e R=2 é a configuração só de tolerância a falhas.

## Metodologia

Não há método no sentido empírico. O artigo é um passeio guiado em três passos: história e CAP, a visão do cliente sobre consistência e a visão do servidor por meio de configurações de quórum. Funciona por definições e pequenos exemplos. Os exemplos dados são o DNS, como o sistema eventualmente consistente mais popular; um RDBMS primário-backup em modo síncrono (N=2, W=2, R=1) e em modo assíncrono com leitura no backup (N=2, W=1, R=1, onde a consistência não pode ser garantida); e o carrinho de compras da Amazon, que continua aceitando escritas durante uma partição e junta os carrinhos depois, com ajuda da aplicação.

## Resultados

São afirmações do artigo, não resultados medidos.

- **Consistência eventual não é exótica.** O envio assíncrono de logs em bancos relacionais comuns já a produz, com a janela de inconsistência definida pela frequência desse envio.
- **A aderência a um servidor importa.** Read-your-writes e leituras monotônicas são relativamente fáceis se o cliente sempre fala com o mesmo servidor, ao custo de um balanceamento de carga e uma tolerância a falhas um pouco mais difíceis. Sessões tornam essa aderência explícita. O cliente também pode garantir as duas propriedades sozinho, marcando as escritas com versões e descartando leituras mais antigas que a última versão vista.
- **Quóruns estritos trocam disponibilidade por consistência.** Com N=3 e W=3 e só dois nós no ar, as escritas falham. Se W < (N+1)/2, conjuntos de escrita que não se sobrepõem podem gerar escritas conflitantes.
- **Partições favorecem o lado da maioria.** Num quórum por maioria clássico, só a partição que tem W nós continua recebendo atualizações. Aplicações que não aceitam isso deixam os dois lados escreverem em novos nós de armazenamento e fazem a junção quando a partição se desfaz.
- **Dois motivos para tolerar inconsistência.** Melhor desempenho de leitura e escrita sob alta concorrência, e manter o sistema disponível sob partições. Para sites, o artigo sugere uma janela de inconsistência menor que o tempo até o cliente carregar a próxima página.
- **O Dynamo é o exemplo de controle explícito.** O artigo diz que o Dynamo deixa o dono de um serviço escolher a troca entre consistência, durabilidade, disponibilidade e desempenho a um dado custo. Não apresenta números do Dynamo.

## Análise crítica

- **Uma voz só, sem avaliação.** O texto é a visão do CTO da Amazon. Não há medição, nem dados sobre janelas de inconsistência ou taxas de falha, nem avaliação independente. Afirmações como "N pode ser dezenas ou até centenas de nós" são asserções.
- **Nada é provado.** O enunciado do CAP é atribuído a Brewer e a Gilbert e Lynch, não demonstrado aqui. As definições dos modelos são informais. Por exemplo, dizer que read-your-writes é um caso especial de consistência causal é afirmado, não argumentado.
- **Só dois exemplos de sistemas da Amazon são de fato usados.** S3 e SimpleDB aparecem na primeira frase, mas o artigo nunca diz que modelo de consistência eles oferecem. Só o carrinho de compras e o Dynamo se ligam às ideias.
- **Ler o CAP como "escolha dois" simplifica.** O próprio artigo nota que partições são inevitáveis, o que transforma a escolha em C ou A durante uma partição. O tratamento formal posterior, na entrada de Gilbert e Lynch deste catálogo, vai além, mas é literatura posterior e a comparação aqui se apoia na entrada do catálogo, não em uma nova leitura daquele artigo.
- **Literatura posterior (não relida para esta entrada; baseada nas análises do catálogo).** [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) classifica read-your-writes e a consistência causal apenas como "sticky available", o que combina com a observação do artigo sobre aderência, e classifica leituras e escritas monotônicas como altamente disponíveis. [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) pergunta quando a coordenação é de fato necessária, e os [CRDTs](/papers/conflict-free-replicated-data-types) e o [CRDT de JSON](/papers/conflict-free-replicated-json-datatype) oferecem funções de junção com garantia de convergência, onde o artigo deixa a junção por conta da aplicação.
- **A versão do blog difere só na redação.** O texto revisado em HTML no site do autor, que comparei com o PDF da CACM, tem a mesma estrutura, as mesmas definições, os mesmos exemplos de N, W, R e as mesmas conclusões. As diferenças são editoriais: o blog data o post anterior em dezembro de 2007 e lista todos os autores do Dynamo, enquanto o PDF diz "et al." e acrescenta que uma versão saiu na edição de outubro de 2008 da ACM Queue. Não encontrei diferença técnica.

## Pesquisas futuras

- Quantificar a janela de inconsistência em implantações reais, que o artigo só descreve de forma qualitativa.
- Definições formais dos modelos de sessão e causal e sua relação com os níveis de isolamento.
- Tipos de dados e funções de junção que tornem a convergência uma propriedade dos dados, não do código da aplicação.
- Formas práticas de expor essas garantias aos desenvolvedores, já que o ponto final do artigo é que eles precisam conhecê-las.
