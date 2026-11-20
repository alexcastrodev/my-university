---
title: "A cauda em escala (The Tail at Scale)"
summary: Dean e Barroso mostram que soluços raros de latência em servidores individuais passam a dominar o tempo de resposta quando uma requisição se espalha por muitos servidores (63% das requisições lentas com 100 servidores a 1 em 100), e descrevem as técnicas que o Google usa para tolerá-los, de requisições hedged e tied a micropartições e requisições canário.
researchArea: Sistemas distribuídos
keywords: latência de cauda, fan-out, requisições hedged, requisições tied, micropartições, replicação seletiva, requisições canário, sistemas tolerantes à cauda
version: 1.0
updatedAt: 2026-11-20
---

## Visão geral

Sistemas que respondem em cerca de 100 ms parecem fluidos para o usuário, e a busca do Google atualiza os resultados enquanto a pessoa digita, consultando milhares de servidores. O artigo (Communications of the ACM, fevereiro de 2013, pp. 74-80, na seção "contributed articles"; não tem abstract, só um texto de abertura) parte de uma observação: nessa escala, a resposta lenta e rara de uma máquina deixa de ser rara para a requisição inteira. Os autores propõem tratar isso como se trata a tolerância a falhas: um todo previsivelmente responsivo feito de partes menos previsíveis, que chamam de sistemas "tolerantes à cauda de latência".

É uma síntese de práticas de sistemas do Google e se conecta a vários papers do catálogo. [BigTable](/papers/bigtable-distributed-storage-system-structured-data) e [GFS](/papers/google-file-system) fornecem os benchmarks, o [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) é a carga em lote que divide o cluster, e o [Dapper](/papers/dapper-large-scale-distributed-systems-tracing-infrastructure) é o sistema de tracing que torna esse tipo de cauda visível. Protocolos de quórum como o [Paxos](/papers/paxos-made-simple) são citados como tolerantes à cauda por natureza. O hedging reaparece no [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) e, dentro de consenso, no [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus). Os escalonadores em escala de microssegundos [Shinjuku](/papers/shinjuku-preemptive-scheduling-for-usecond-scale-tail-latency) e [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads) atacam causas da mesma cauda dentro de uma única máquina.

Vale saber antes: latência por percentil (o percentil 99 é o valor que 99% das requisições batem) e a árvore raiz-folhas de um serviço com fan-out.

## Contribuição

- **O argumento da amplificação.** Se um servidor responde em 10 ms mas tem latência de 1 segundo no percentil 99, uma requisição em 100 fica lenta quando atendida por um único servidor assim. Se a requisição precisa de 100 desses servidores em paralelo, 63% das requisições levam mais de um segundo. Com 1 em 10.000 lenta no servidor e 2.000 servidores, quase uma em cada cinco requisições (0,18 na figura) fica lenta.
- **Causas da variabilidade.** Recursos compartilhados na máquina (núcleos de CPU, caches, banda de memória e de rede), daemons, recursos globais compartilhados (switches, sistemas de arquivos compartilhados), atividades de manutenção (reconstrução de dados, compactações de log do BigTable, coleta de lixo) e várias camadas de filas. O hardware acrescenta limites de potência e throttling, coleta de lixo em armazenamento de estado sólido (latência de leitura até 100 vezes maior com escrita modesta) e modos de economia de energia.
- **Reduzir a variabilidade do componente.** Classes de serviço e filas de baixo nível rasas, quebrar requisições longas em menores contra o bloqueio no início da fila, e limitar, dividir ou sincronizar o trabalho em segundo plano. O texto diz explicitamente que cache não resolve diretamente a latência de cauda.
- **Adaptações dentro da requisição** (dezenas de milissegundos): requisições hedged e tied.
- **Adaptações entre requisições** (dezenas de segundos a minutos): micropartições, replicação seletiva, período de provação induzido por latência.
- **Para sistemas de recuperação de informação:** resultados "bons o bastante" e requisições canário. Uma seção curta trata de mutações, que os autores dizem ser mais fáceis de tornar tolerantes à cauda.

## Metodologia

Não há um desenho experimental no sentido usual. O artigo explica o problema com um modelo hipotético (Figura 1) e uma medição de um serviço real do Google (Tabela 1), depois descreve cada técnica com um breve relato de como o Google a usa, mais dois benchmarks: a leitura de 1.000 chaves no BigTable com hedging, e um benchmark de leitura do BigTable com requisições tied (Tabela 2). Não há código, cargas nem tamanhos de cluster além do que está citado abaixo, e os resultados não são repetidos nem comparados com outros sistemas.

## Resultados

Todos os números são dos próprios autores, como impressos no texto e nas tabelas.

- **Serviço real (Tabela 1).** Medido na raiz de uma árvore de fan-out grande, uma folha qualquer termina em 10 ms no percentil 99, mas esperar todas as folhas leva 140 ms, e 95% das folhas leva 70 ms. Esperar os 5% mais lentos responde por metade da latência do percentil 99. As medianas vão de 1 ms (uma folha) a 40 ms (todas as folhas).
- **Requisições hedged.** Enviar a requisição secundária só depois que a primeira passou do percentil 95 da latência esperada limita a carga extra a cerca de 5%. Em um benchmark que lê 1.000 chaves de uma tabela do BigTable distribuída em 100 servidores, um hedge após 10 ms reduz a latência do percentil 99,9 para obter os 1.000 valores de 1.800 ms para 74 ms, enviando apenas 2% mais requisições.
- **Requisições tied (Tabela 2).** Cada cópia carrega a identidade da outra e a cancela ao começar. Em um cluster quase ocioso, com uma requisição tied após 1 ms, a latência mediana de leitura vai de 19 ms para 16 ms (-16%), o percentil 99 de 67 ms para 42 ms (-37%) e o 99,9 de 98 ms para 61 ms (-38%). Com um job terasort concorrente, o 99,9 vai de 159 ms para 108 ms (-32%), e o perfil fica quase idêntico ao do cluster ocioso sem requisições tied. O custo em utilização de disco é menor que 1%.
- **Micropartições.** Com 20 partições por máquina, dá para tirar carga em passos de cerca de 5% e em 1/20 do tempo de um mapeamento um para um. As máquinas do BigTable gerenciam entre 20 e 1.000 tablets.
- **Demais técnicas, descritas sem números.** Período de provação por latência (uma máquina lenta é excluída, mas continua recebendo requisições sombra), resultados bons o bastante (uma folha tem o melhor resultado em menos de uma em 1.000 consultas) e requisições canário (a requisição vai primeiro a uma ou duas folhas, e é usada em toda requisição dos grandes sistemas de busca com fan-out do Google).

## Análise crítica

O que o artigo não afirma nem mede:

- **Síntese, não avaliação.** As únicas medições são dois benchmarks e uma tabela, todos do Google, nenhum independente, e nenhum comparado com as alternativas que o texto discute (sondar filas, roteamento por carga). A maioria das técnicas (provação, bom o bastante, canário, replicação seletiva) vem sem número algum.
- **A carga extra tem preço.** O hedging adiciona requisições; os 2% e 5% pertencem aos casos descritos, e o texto diz que o hedging ingênuo costuma acrescentar carga inaceitável. Um uso agressivo exige cancelamento mais rápido. Requisições tied têm uma janela de cerca de um atraso de mensagem de rede em que as duas cópias podem executar. Não leia os 5% como o custo do benchmark: é o limite da regra de adiamento, e o benchmark em si enviou 2% mais requisições.
- **Uma suposição de independência.** Os autores dizem que as técnicas só funcionam quando a causa da lentidão não atinge várias réplicas ao mesmo tempo, e "esperam" que essas causas não correlacionadas sejam comuns, sem medir isso.
- **Escopo.** As técnicas servem a operações que não alteram estado crítico; para mutações o artigo dá argumentos curtos (escala pequena, fora do caminho crítico, quóruns) e nenhuma avaliação.
- **As afirmações sobre hardware são previsões.** Dizer que a variabilidade vai crescer e que RDMA e mais banda de bisseção vão baratear as requisições tied são expectativas, não resultados.

Literatura posterior, ligada por entradas do catálogo e não pelos artigos originais: [Metastable Failures](/papers/metastable-failures-in-distributed-systems) descreve retries como um efeito de sustentação que aumenta a carga durante a sobrecarga, o que é motivo para tratar a carga extra de qualquer técnica parecida com retry como um risco a orçar. A análise do [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) no catálogo registra que o paper evita de propósito o hedging entre seus próprios servidores, porque duplicaria as verificações mais caras. Não li os trabalhos posteriores sobre caudas em escala de microssegundos (Caladan e outros) para esta entrada.

## Pesquisas futuras

- Técnicas que funcionam em escala de microssegundos, onde preempção e alocação de núcleos pesam mais que a escolha de réplica ([Shinjuku](/papers/shinjuku-preemptive-scheduling-for-usecond-scale-tail-latency), [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads)).
- Medir quão correlacionados são de fato os episódios lentos entre réplicas, o que decide quando requisições hedged e tied ajudam.
- Orçar a carga extra de hedging, retries e canários para que eles mesmos não causem sobrecarga ([Metastable Failures](/papers/metastable-failures-in-distributed-systems)).
- Consenso tolerante à cauda sem timeouts ([QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus)).
