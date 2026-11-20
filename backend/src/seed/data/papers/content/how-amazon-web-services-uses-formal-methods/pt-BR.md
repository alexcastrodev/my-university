---
title: "Como a Amazon Web Services usa métodos formais"
summary: Seis engenheiros da AWS relatam que, desde 2011, escrevem especificações em TLA+ e PlusCal dos algoritmos centrais do S3, do DynamoDB, do EBS e de um gerenciador de locks interno, verificam com o model checker TLC e encontram bugs sutis de projeto, um deles exigindo um traço de 35 passos, que revisões e testes não pegaram.
researchArea: Sistemas distribuídos
keywords: TLA+, PlusCal, model checker TLC, especificação formal, verificação de projeto, model checking, AWS, DynamoDB
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

O artigo não tem um resumo separado. Ele abre com este parágrafo: desde 2011, engenheiros da Amazon Web Services (AWS) usam especificação formal e model checking para resolver problemas difíceis de projeto em sistemas críticos. Os autores descrevem a motivação e a experiência, o que funcionou bem no domínio deles e o que não funcionou. Ao falar de experiência pessoal, referem-se aos autores pelas iniciais. O subtítulo acrescenta: engenheiros usam TLA+ para impedir que bugs graves, mas sutis, cheguem à produção.

## Visão geral

Os serviços da AWS parecem simples por fora e se apoiam em sistemas distribuídos complexos. O artigo dá o S3 como exemplo: um trilhão de objetos seis anos depois do lançamento em 2006, dois trilhões menos de um ano depois, e 1,1 milhão de requisições por segundo. Cada serviço depende de algoritmos tolerantes a falhas para replicação, consistência, controle de concorrência, auto-scaling e balanceamento de carga, que precisam ser adaptados para funcionar juntos e às vezes inventados. Os autores já usam revisões de projeto, revisões de código, análise estática, testes de estresse e testes com injeção de falhas, e mesmo assim encontram bugs sutis escondidos nesses sistemas. O diagnóstico deles é que a intuição humana estima mal combinações de eventos "extremamente raras" a milhões de requisições por segundo, e que testar o código não acha erros sutis de projeto, porque os estados alcançáveis do código são astronômicos.

É um artigo da CACM (abril de 2015, volume 58, número 4, pp. 66-73), um relato de experiência de uma empresa, não uma avaliação de pesquisa. Vários artigos do catálogo atacam o mesmo problema por outros ângulos: [Paxos Made Live](/papers/paxos-made-live-engineering-perspective) testa uma implementação de Paxos com injeção aleatória de falhas, [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) estuda falhas de implementação, e o [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) é o sistema cujo protocolo Zave analisou com Alloy, a evidência que convenceu o autor C.N. a tentar métodos formais. O [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) é outro sistema da Amazon, anterior: o DynamoDB do artigo é o serviço lançado em janeiro de 2012, que promete consistência forte, e o artigo não cita o trabalho de 2007.

Vale conhecer antes: segurança (safety, o que o sistema pode fazer) versus vivacidade (liveness, o que ele precisa fazer eventualmente), e a ideia de que um model checker explora todos os intercalamentos de uma instância do projeto.

## Contribuição

- **Uma linguagem de projeto precisa que os engenheiros adotam.** O TLA+ se baseia em teoria de conjuntos e predicados básicos e descreve todos os comportamentos legais de um sistema. Propriedades de correção e projetos são degraus de uma mesma "escada de abstração". O PlusCal, que vira TLA+ com um único atalho de teclado, serve como substituto do pseudocódigo, e vários engenheiros o acharam mais produtivo.
- **Outra pergunta de projeto.** Em vez de "o que pode dar errado", especificar "o que precisa dar certo": as propriedades de correção, mais tudo que o ambiente precisa garantir e todo evento que ele pode produzir (erros de rede e de disco, quedas de processo, falhas de data center, ações de operadores), e deixar o verificador tentar todos os intercalamentos.
- **Evidência de 10 sistemas reais.** O artigo lista o que foi especificado e o que se achou (lista a seguir).
- **Uma postura prática sobre limites.** Diz abertamente que o código não é verificado contra o projeto e quais classes de problema o método não cobre.

A tabela de sistemas do artigo, como relatada:

- **S3, algoritmo de rede de baixo nível tolerante a falhas** (804 linhas de PlusCal): dois bugs, depois outros em otimizações propostas.
- **S3, redistribuição de dados em segundo plano** (645 PlusCal): um bug, depois outro na primeira correção proposta.
- **DynamoDB, sistema de replicação e de membership de grupo** (939 TLA+): três bugs que exigiam traços de até 35 passos.
- **EBS, gerenciamento de volumes** (102 PlusCal): três bugs.
- **Gerenciador de locks distribuído interno, estrutura de dados lock-free** (223 PlusCal): mais confiança, mas não achou um bug de liveness porque liveness não foi verificada.
- **Gerenciador de locks interno, algoritmo de replicação e reconfiguração tolerante a falhas** (318 TLA+): um bug, e verificou uma otimização agressiva.

## Metodologia

Não há desenho experimental. Os autores contam como os métodos formais entraram na AWS e o que aconteceu em cada projeto, usando as iniciais dos engenheiros. C.N. comparou Alloy e TLA+ no mesmo algoritmo concorrente não trivial e achou o Alloy pouco expressivo, por exemplo para sequências dinâmicas de registros aninhados. T.R. então especificou a replicação e a tolerância a falhas do DynamoDB em cerca de duas semanas e verificou com o TLC distribuído em 10 instâncias EC2 cc1.4xlarge (oito núcleos mais hyperthreads e 23 GB de RAM cada). Uma palestra chamada "Debugging Designs" e o slogan "pseudocódigo exaustivamente testável" trouxeram times do S3 (F.Z., B.M.), e M.B. e M.D. aprenderam sozinhos a partir de palestras internas. Os engenheiros adotaram a prática de escrever primeiro um documento de projeto em prosa e refinar partes dele em PlusCal ou TLA+.

## Resultados

Tudo abaixo são relatos dos próprios autores.

- **Bugs encontrados.** No DynamoDB, o TLC achou um bug de perda de dados quando uma sequência específica de falhas e passos de recuperação se intercalava com outro processamento. O menor traço de erro tinha 35 passos de alto nível. Ele passou por revisões de projeto, revisões de código e testes extensos, e T.R. está convencido de que mais trabalho nessas áreas não o acharia. Mais dois bugs graves apareceram em outros algoritmos. A tabela diz "até 35 passos" para três bugs, enquanto o texto dá 35 como o menor traço de um bug.
- **S3.** A especificação de F.Z. para um novo algoritmo de rede achou dois bugs sutis e depois mostrou que algumas otimizações propostas introduziriam bugs. A primeira especificação de B.M. achou em segundos um bug que só tinha aparecido depois de meses de testes; a primeira correção proposta ainda falhava por outro traço, e uma segunda correção foi verificada. A segunda especificação dele não achou bugs, mas resolveu ambiguidades da documentação. M.D. achou com TLA+ um bug crítico em um dos novos algoritmos mais importantes, e a especificação de C.N., escrita de forma independente, achou o mesmo bug.
- **Custo e aprendizado.** Engenheiros de júnior a principal aprenderam TLA+ do zero e tiveram resultados úteis em duas a três semanas. T.R. escreveu a especificação do DynamoDB em cerca de duas semanas, F.Z. duas versões em cerca de duas semanas e B.M. gastou duas semanas. T.R. acredita que o TLA+ foi mais confiável e consumiu menos tempo que suas provas informais.
- **Confiança para otimizar.** As especificações permitiram mudanças como estreitar locks ou enfraquecer a ordenação de mensagens que, sem elas, os times "não ousariam" fazer. O refinamento de C.N. de um projeto de replicação levou a uma otimização que reduziu radicalmente a latência de escrita.
- **Adoção.** Sete times usaram TLA+ em 10 sistemas reais, a direção executiva incentiva especificações para novas funcionalidades, e gerentes reservam tempo de engenharia no planejamento anual.
- **Limites declarados.** A especificação formal não ajuda com degradação de desempenho emergente e sustentada, como tempestades de retentativas depois de uma lentidão, e a especificação do gerenciador de locks perdeu um bug de liveness porque liveness não foi verificada.

## Análise crítica

As ressalvas do próprio artigo são claras. Os métodos lidam com modelos, não com o sistema ("todos os modelos estão errados, alguns são úteis"), os autores só buscaram benefício prático no domínio deles e "não tentaram uma pesquisa abrangente", então os resultados podem variar. Eles também respondem à pergunta mais frequente, se o código implementa o projeto verificado, com "não sabemos".

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A evidência é testemunho.** Os autores construíram as especificações, relataram os resultados e trabalham na empresa, sem grupo de comparação nem avaliação independente. As contagens de bugs vêm por projeto, sem contagem de bugs que as especificações deixaram passar além do caso de liveness. Afirmações como "bugs que não acharíamos por nenhuma outra técnica" são convicções dos engenheiros.
- **O custo é sobretudo tempo de aprendizado.** As semanas relatadas são de escrita e aprendizado, e o artigo não dá números do esforço de model checking além do cluster do DynamoDB, nem de manter as especificações em sincronia com um código que muda.
- **Projeto, não implementação.** O artigo verifica projetos. Trabalhos posteriores do catálogo verificam implementações, por exemplo o [IronFleet](/papers/ironfleet-proving-practical-distributed-systems-correct), que prova no código uma biblioteca de máquina de estados replicada baseada em Paxos e um banco chave-valor particionado, liveness incluída, e o [Verdi](/papers/verdi-framework-for-implementing-and-formally-verifying-distributed-systems), um arcabouço em Coq que verifica sistemas primeiro sob uma rede idealizada e depois os transforma para modelos de falha mais duros. O [Grove](/papers/grove-separation-logic-library-for-verifying-distributed-systems) e o [seL4](/papers/sel4-formal-verification-of-an-os-kernel) também verificam implementações. É literatura paralela ou posterior que esta revisão conhece só pelos resumos do catálogo, e o artigo da AWS não cita o IronFleet nem o Verdi.
- **A lacuna do desempenho emergente é um tema de pesquisa próprio.** A classe de falhas que o artigo diz não saber modelar é próxima do que o [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) estuda depois, com postmortems públicos de incidentes em várias organizações. De novo, trabalho posterior conhecido aqui só pelo resumo do catálogo.

## Pesquisas futuras

- Ligar projeto e código: o artigo não conhece ferramenta que verifique a conformidade do código com uma especificação de alto nível em sistemas do tamanho dos da AWS, e menciona usar o TLC para achar casos de borda para testar código, experimentado só em hardware por Tasiran e colegas.
- Verificar liveness de rotina, já que o caso do gerenciador de locks perdeu um bug dessa classe.
- Um jeito viável de modelar a degradação de desempenho emergente, que os autores dizem ainda não conhecer.
- Quanto do benefício se mantém com outras ferramentas ou em outros domínios, o que os autores deixam explicitamente em aberto.
