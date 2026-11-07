---
title: "Halfmoon: computação serverless com estado, tolerante a falhas e com logging ótimo"
summary: O Halfmoon barateia as funções serverless com estado e semântica exactly-once ao registrar no log apenas as leituras ou apenas as escritas, com um protocolo para cargas com muita leitura e outro para cargas com muita escrita, um argumento de pior caso de que nenhum dos dois pode registrar menos e uma troca entre eles em tempo de execução.
researchArea: Sistemas distribuídos
keywords: serverless, semântica exactly-once, log compartilhado, idempotência, logging assimétrico, tolerância a falhas, consistência sequencial
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Na computação serverless, a lógica da função não guarda estado e o estado compartilhado fica em um armazenamento externo. Uma função serverless com estado (SSF) que escreve nesse armazenamento e depois cai é reexecutada pelo runtime, e a nova execução repete uma escrita que já tinha tido efeito. O objetivo é a semântica exactly-once: não importa quantas vezes uma SSF caia e seja reexecutada, o efeito sobre o estado externo deve ser igual ao de uma execução sem queda. Os sistemas existentes chegam lá associando um registro de log a cada leitura e escrita, de modo que a reexecução reproduz os resultados das leituras e pula as escritas já concluídas. Os autores chamam isso de logging simétrico.

Este artigo do SOSP 2023 (Koblenz), de Sheng Qi, Xuanzhe Liu e Xin Jin, da Peking University, argumenta que o logging não é de graça. Medido no Boki com o DynamoDB como armazenamento, uma operação de log leva 1,18 ms na mediana e 1,91 ms no p99, contra 1,88 ms e 4,60 ms de uma leitura e 2,47 ms e 5,86 ms de uma escrita. O Halfmoon é a resposta deles: um runtime que registra no log só um dos dois tipos de operação.

Cinco termos sustentam o artigo. A idempotência é tratada como **estabilidade de timestamps**: toda leitura e escrita é parametrizada por uma posição (um seqnum) no fluxo de eventos, uma escrita deve sempre ter efeito na mesma posição e uma leitura deve sempre buscar para trás a partir da mesma. **cursorTS** é uma variável por SSF com o seqnum de sua última operação registrada, usada para derivar timestamps das operações que não são registradas. **Halfmoon-read** registra só escritas e **Halfmoon-write** registra só leituras. **Ótimo em logging** (log-optimal) significa que nenhum protocolo tem uma contagem de operações de log menor no pior caso.

Vale conhecer antes: a abstração de log compartilhado, no [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) (a base de comparação e o código sobre o qual o protótipo foi feito), no [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) e no [CORFU](/papers/corfu-shared-log-design-for-flash-clusters), que o artigo cita, além da diferença entre entrega at-least-once e exactly-once e entre consistência sequencial e linearizabilidade. Um pareamento meu, não citado pelo artigo: o [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) também persiste um pequeno esqueleto (as entradas ordenadas) e recupera o resto por reexecução determinística.

## Contribuição

- **Timestamps em vez de logs.** Um evento registrado é persistente por si só, mas um não registrado precisa ser recuperável a partir de outros. Os autores dão às operações não registradas timestamps lógicos calculados a partir do cursorTS, porque o tempo real não pode ser recuperado depois de uma queda. O preço é abrir mão da garantia de tempo real da linearizabilidade, que eles argumentam que muitas aplicações serverless não precisam (citam leituras repetíveis e consistência causal no Cloudburst e atomicidade de leitura no AFT).
- **Halfmoon-read, leituras sem log.** Cada SSF acrescenta um registro de init cujo seqnum vira seu cursorTS. Uma escrita deriva um número de versão determinístico, grava uma nova versão do objeto (multi-versionamento sobre uma API chave-valor simples) e depois registra o número da versão com duas tags, o id da SSF e a chave do objeto. Esse registro é ao mesmo tempo um checkpoint e o ponto de commit que as outras SSFs enxergam. Uma leitura faz `logReadPrev` no log de escritas da chave a partir do seu cursorTS e busca essa versão, então precisa de uma consulta ao log, mas não de um append. O protótipo registra duas vezes por escrita, como o Boki, de modo que os ganhos vêm só das leituras.
- **Halfmoon-write, escritas sem log.** As leituras são registradas com seus resultados. Uma escrita é uma atualização condicional em um objeto de versão única, com número de versão (cursorTS, contador de escritas consecutivas), aplicada só se a versão armazenada for menor. Uma escrita reexecutada, portanto, cai no mesmo ponto ou é descartada.
- **Otimalidade em logging.** O Lema 4.5 diz que, se um protocolo permite escritas sem log com efeito visível, as leituras não podem ser sem log, porque uma queda seguida de uma dessas escritas pode tornar irrecuperável o resultado antigo da leitura. Ele se apoia em duas premissas: escritas sem log não têm memória e a lógica da SSF é desconhecida das outras SSFs. O Teorema 4.6 decorre disso: no pior caso um protocolo registra todas as leituras ou todas as escritas visíveis, para um único objeto.
- **Consistência.** O Halfmoon-read dá consistência sequencial. O Halfmoon-write é equivalente a ela desde que escritas sem log consecutivas em objetos diferentes sejam comutativas, já que a ordem efetiva pode trocá-las entre dois eventos registrados. O init avança o cursorTS, então uma SSF iniciada depois do fim de uma operação enxerga seus efeitos, e um log `sync` dá acesso linearizável sob demanda.
- **Escolha e troca.** Os protocolos podem ser diferentes por objeto. Em armazenamento, o Halfmoon-read ganha quando a probabilidade de leitura supera a de escrita. Em tempo de execução, ganha quando as leituras são duas vezes mais prováveis que as escritas, porque o custo extra de uma escrita é cerca do dobro do de uma leitura no protótipo. Um log de transição com registros BEGIN e END conduz a troca. As SSFs que começam durante uma troca usam um protocolo transitório que registra tudo até que todas as SSFs iniciadas no protocolo antigo terminem.
- **Outros mecanismos.** O `logCondAppend` funciona como um compare-and-swap, de modo que só uma das várias instâncias pares da mesma invocação registra um passo, e a coleta de lixo apaga registros do log de escritas e versões de objetos quando nenhuma SSF em execução pode mais lê-los. O artigo cita o [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) e o [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log) para os sub-fluxos com tags.

## Metodologia

O protótipo modifica cerca de 2300 linhas de C++ na camada de logging do Boki e acrescenta uma biblioteca cliente em Go de 1700 linhas. Os experimentos rodam em instâncias AWS EC2 c5d.2xlarge (8 vCPUs, 16 GiB, NVMe) com oito nós de função, um gateway, três nós de armazenamento e um sequenciador, usando o DynamoDB como armazenamento externo. As bases de comparação são o Boki e uma variante insegura sem nenhum logging.

Os microbenchmarks rodam uma SSF sintética com uma leitura e uma escrita por requisição sobre 10K objetos (chaves de 8B, valores de 256B) por 10 minutos. As aplicações são reserva de viagens (10 SSFs, com muita leitura) e avaliação de filmes (13 SSFs, um pouco inclinada para escrita), do DeathStarBench, e o Retwis (com muita leitura), cada uma sob os dois protocolos. Os experimentos de overhead usam uma SSF de 10 operações com proporção de leitura variável, objetos de 256B e 1KB, intervalos de GC de 10 s e 60 s e taxas de 100 a 400 requisições por segundo. A troca usa duas fases alternadas de cinco segundos, a 300 e a 600 requisições por segundo. A versão estendida acrescenta medições sob taxas de falha e especificações em TLA+ dos protocolos.

## Resultados

Estes são os resultados relatados pelos autores.

- **Microbenchmarks.** O Halfmoon-read tem latência de leitura cerca de 30% menor que a do Boki e latência de escrita parecida, e suas leituras custam cerca de 15% acima das leituras cruas inseguras, o que os autores colocam em 4× a 5× menos overhead que o Boki. O Halfmoon-write tem latência de escrita cerca de 30% menor, e seu overhead é de 2× a 6× menor que o do Boki. Escritas sem log ainda custam mais que escritas cruas, porque as atualizações condicionais são mais lentas.
- **Aplicações.** Com o protocolo certo, a latência mediana é de 20% a 40% menor nas três cargas, e o overhead acima da base insegura é de 1,5× a 4,0× menor. O Halfmoon-read ganha em reserva de viagens e no Retwis, e o Halfmoon-write em avaliação de filmes. O Boki satura mais ou menos na mesma carga, já que o logging não é seu gargalo, e o Halfmoon o supera mesmo com o protocolo errado.
- **Armazenamento.** O Halfmoon usa em média de 1,2× a 3,4× menos armazenamento que o Boki, mas o Halfmoon-read usa mais que o Boki com proporções baixas de leitura. O ponto de cruzamento previsto é uma proporção de leitura de 0,5, e o medido é um pouco maior, aproximando-se de 0,5 conforme os objetos crescem.
- **Tempo de execução.** Os dois protocolos melhoram a latência mediana em 1,2× a 1,5×. O cruzamento previsto é uma proporção de leitura de 2/3, o medido é um pouco maior, e a taxa de requisições quase não o move.
- **Troca.** Ela leva menos de 100 ms a 300 requisições por segundo. A 600 (a saturação fica perto de 800) é mais lenta do Halfmoon-write para o Halfmoon-read do que na volta, porque as SSFs com muita escrita duram mais e o protocolo antigo precisa esvaziar.
- **Falhas.** A reexecução reproduz as operações sem log, enquanto o Boki pode pular as registradas. A versão estendida encontra o Halfmoon à frente do Boki abaixo de probabilidades de falha de 30% (só leitura) e 40% (só escrita). Com 10%, seu p99 é de 62,69 ms contra 52,06 ms (só leitura) e 103,79 ms contra 92,97 ms (só escrita), o que os autores chamam de 10% a 20% maior.

## Análise crítica

A ideia é simples e a dualidade é elegante. O artigo admite vários limites.

- **Consistência mais fraca.** A garantia é consistência sequencial, não linearizabilidade, e o Halfmoon-write pode reordenar escritas consecutivas em objetos diferentes, a menos que as dependências sejam explicitadas por invocações ou por logging extra.
- **Cobertura.** O Halfmoon-read não suporta scans, joins nem agregações sobre tabelas mutáveis, as transações reaproveitam APIs existentes, e o log de escritas do Halfmoon-read fica visível às outras SSFs, então campos privados precisam de controle de acesso ou criptografia. O desenho supõe SSFs determinísticas e um runtime que reexecuta as quedas, e trata toda operação externa como não idempotente.
- **Viés para o caso sem falhas.** Os protocolos são ajustados para o caso comum, e a recuperação reproduz mais do que um protocolo simétrico reproduziria.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **"Ótimo em logging" é estreito.** Significa pior caso, um objeto, uma contagem de operações de log abstratas, duas premissas declaradas e uma garantia que já abriu mão da ordem de tempo real. Os autores observam que o custo real depende da implementação. O texto principal prova o Lema 4.5 em um parágrafo, e o apêndice em TLA+ lista invariantes, mas não relata nenhuma execução de model checking (limites, estados, tempo).
- **O protótipo não está no limite para escritas.** Ele mantém o logging duplo do Boki nas escritas e registra no init. Isso é conservador, mas os sistemas medidos mostram só o lado das leituras do limite.
- **Uma base de comparação, um ambiente.** O Boki é o único concorrente simétrico, seu código hospeda o protótipo e todas as rodadas usam uma configuração da AWS com o DynamoDB. A divisão por carga por trás de "20% a 40%" e de "1,5× a 4,0×" está só na Figura 11, e o "overhead de logging" do resumo é, no corpo do texto, o overhead acima da base insegura.
- **Os números da motivação não batem.** A introdução diz que o logging custa de 30% a 50% sobre as operações cruas, enquanto a Tabela 1 dá de 33% a 63%. Dividir a latência de log da tabela pela latência da operação dá exatamente essas porcentagens (1,18 sobre 1,88 é 63%), então elas se leem como a fatia da operação, e não há latências cruas tabeladas.
- **A evidência de falhas é tardia e parcial.** O texto da conferência não tem rodada com injeção de falhas, "supera de longe a taxa de falha real" é afirmado, e os resultados estendidos usam só os extremos de só leitura e só escrita. A latência de cauda sob falhas é pior que a do Boki.
- **Escolha e troca são pouco testadas.** O critério é por objeto, mas os experimentos escolhem um protocolo por carga, e as rodadas de overhead acessam objetos aleatórios. Os dois cruzamentos (0,5 e 2/3) deixam uma faixa que pede um custo ponderado, que o artigo sugere, mas não aplica, e ele não descreve política para decidir quando trocar.
- **A coleta de lixo segue a SSF mais lenta.** A condição (b) mantém uma versão até que toda SSF iniciada antes de sua sucessora termine, enquanto o modelo de armazenamento supõe um tempo de vida médio.

## Pesquisas futuras

- Combinar o Halfmoon com análise de programas e verificação de idempotência para pular o logging de operações que já são seguras, o que os autores citam, como leituras de objetos somente leitura.
- Consultas em nível de tabela sobre tabelas mutáveis no Halfmoon-read, por exemplo guardando o índice do banco na camada de logging, além de checkpoints assíncronos para acelerar a reexecução.
- Seleção automática de protocolo por objeto e troca sob cargas reais com distribuição desigual, com falhas injetadas nas aplicações ponta a ponta.
- Executá-lo sobre um orquestrador que ofereça a camada de retentativas. O [Dirigent](/papers/dirigent-lightweight-serverless-orchestration) oferece at-least-once só para invocações assíncronas, um pareamento meu que o artigo não faz.
