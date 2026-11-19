---
title: "Dicas para o projeto de sistemas computacionais"
summary: Lampson destila a experiência com o Alto, a Ethernet, o Pilot, o Bravo e outros sistemas do Xerox PARC em slogans informais ("keep it simple", "cache answers", "use hints", "log updates", "end-to-end"), organizados pelo que dão a um sistema (funcionalidade, velocidade, tolerância a falhas) e por onde se aplicam no projeto. Ele os chama de dicas, não de leis.
researchArea: Sistemas operacionais
keywords: projeto de sistemas, interfaces, simplicidade, cache, dicas, argumento fim a fim, logs, ações atômicas
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Estudar o projeto e a implementação de vários sistemas computacionais levou a algumas dicas gerais para o projeto de sistemas. Elas são descritas aqui e ilustradas com muitos exemplos, que vão de hardware, como o Alto e o Dorado, a programas de aplicação, como o Bravo e o Star.

## Visão geral

Butler Lampson apresentou este artigo no Nono Simpósio da ACM sobre Princípios de Sistemas Operacionais (Bretton Woods, outubro de 1983), e ele saiu no Operating Systems Review 15(5), páginas 33 a 48. O texto que li é a cópia levemente revisada pelo próprio autor dessa versão. O autor, do Xerox Palo Alto Research Center, diz que "projetou e construiu vários sistemas computacionais, alguns que funcionaram e outros que não", e avisa logo no início: "não reivindico originalidade; a maioria é sabedoria popular de projetistas experientes". O artigo abre contrastando projeto de sistemas com projeto de algoritmos: o requisito é menos preciso, há muito mais estrutura interna e a medida de sucesso é menos clara.

Cada dica vem com um slogan. A Figura 1 organiza os slogans em dois eixos: por que ajuda (funcionalidade, "funciona?", velocidade, "é rápido o bastante?", tolerância a falhas, "continua funcionando?") e onde ajuda (completude, interface, implementação). As seções 2, 3 e 4 seguem as três colunas do "por quê". O autor também diz que evita "exortações à modularidade" e metodologias de projeto top-down ou bottom-up.

Vale conhecer antes: o que é uma interface, como funcionam um sistema de arquivos e uma memória virtual, e o que é um cache. Os pareamentos abaixo com o catálogo são meus, o artigo de 1983 não pode citá-los. [O sistema de tempo compartilhado UNIX](/papers/unix-time-sharing-system) é o sistema por trás do exemplo de "faça uma coisa só e bem feita" (o artigo cita a versão de 1978 do Bell System Technical Journal, não a de 1974 daqui). [Access Path Selection](/papers/system-r-access-path-selection) vem do projeto System R, cujo gerenciador de recuperação Lampson cita ao falar de logs. Para logs, caches e falhas na escala do Google e da Amazon, veja o [Google File System](/papers/google-file-system), o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store). Um vizinho no estilo de princípios de projeto é [A proteção da informação em sistemas computacionais](/papers/protection-of-information-in-computer-systems).

## Contribuição

- **Uma classificação, não uma teoria.** Os slogans ficam numa tabela de dois eixos (Figura 1). Slogans repetidos (por exemplo end-to-end, cache answers, use hints, make actions atomic) aparecem em mais de uma célula.
- **Funcionalidade.** As interfaces vêm primeiro, e o artigo diz que defini-las é "a parte mais importante do projeto de sistemas". Pede que uma interface seja simples, completa e implementável de forma pequena e rápida. Dicas daqui: faça uma coisa de cada vez e bem feita, não generalize, acerte, faça rápido em vez de geral ou poderoso, não esconda poder, use argumentos de procedimento, deixe para o cliente, mantenha estáveis as interfaces básicas, mantenha um lugar onde pisar, planeje jogar o primeiro fora, guarde segredos, divida e conquiste, reuse uma boa ideia.
- **Tratar todos os casos.** Trate o caso normal e o pior caso separadamente: o caso normal precisa ser rápido, e o pior caso precisa fazer algum progresso.
- **Velocidade.** Divida os recursos de forma fixa, use análise estática se puder, use tradução dinâmica, guarde respostas em cache, use dicas, use força bruta na dúvida, calcule em segundo plano, use processamento em lote, segurança primeiro, descarte carga.
- **Tolerância a falhas.** A recuperação de erros fim a fim é a parte logicamente necessária, e os níveis inferiores servem "estritamente para desempenho". Registre as atualizações em log como o registro da verdade e torne as ações atômicas ou reiniciáveis.
- **Dicas contra caches.** Uma dica é um resultado salvo que pode estar errado e não é necessariamente achado por busca associativa, então precisa ser conferida contra a "verdade" antes de qualquer ação irrecuperável.

## Metodologia

Não há experimento. O método é o argumento por exemplo: cada slogan é explicado em um ou dois parágrafos e ligado a sistemas que o autor conhecia bem, com referências para quase todos os exemplos específicos e poucas para as ideias em si. Os exemplos vêm de hardware (Alto, Dorado, Ethernet), sistemas operacionais (SDS 940, SO do Alto, Pilot, Tenex, Cal), sistemas de programação (Lisp, Mesa, Interlisp-D, Cedar, Smalltalk), aplicações (Bravo, Star) e servidores (impressora Dover, Grapevine, Juniper). Citações de Hamlet, em geral os conselhos de Polônio a Laertes, encabeçam as dicas.

O artigo lista o que não é: não é novo (com poucas exceções), não são receitas infalíveis, não são leis de projeto ou operação de sistemas, não é formulado com precisão, não é consistente, nem sempre é apropriado, não é aprovado por todos os grandes especialistas e não tem garantia de funcionar.

## Resultados

O artigo não traz medições próprias, então abaixo estão as afirmações e os números que ele cita.

- **Custo de interface.** Se seis níveis de abstração custam cada um 50% mais do que é "razoável", o serviço no topo erra por mais de um fator 10. O sistema de arquivos do Alto (cerca de 900 linhas) e o de paginação (cerca de 500 linhas) são pequenos e rápidos, enquanto o Pilot, que mapeia páginas virtuais em páginas de arquivo, tem cerca de 11.000 linhas e muitas vezes precisa de dois acessos a disco por falta de página.
- **Tenex.** Uma chamada de sistema que recebe a senha por referência e avisa o usuário sobre páginas não atribuídas permite descobrir uma senha de n caracteres em 64n tentativas em média, em vez de 128n/2.
- **Rápido e simples.** Máquinas como o 801 e o RISC, com instruções simples e rápidas, podem rodar programas mais depressa que máquinas com instruções mais gerais, e um conjunto de ferramentas de medição acelerou o Interlisp-D por um fator 10. O artigo diz que é normal 80% do tempo ser gasto em 20% do código.
- **Caso normal e pior caso.** "Uma queda por semana costuma ser um preço barato por 20% de desempenho a mais", desde que a recuperação de erros seja decente. O Cedar trata toda variável local como possível ponteiro, e as medições mostram que menos de 1% do armazenamento é retido por engano.
- **Dicas na prática.** Rótulos de disco do Alto e do Pilot, tabelas de roteamento da Arpanet, detecção de portadora e backoff exponencial da Ethernet, e a busca de métodos do Smalltalk, em que o tipo guardado em cache acerta cerca de 96% das vezes.
- **Recursos.** Não se pode esperar que um sistema funcione bem "se a demanda por algum recurso passa de dois terços da capacidade, a menos que a carga seja caracterizada extremamente bem". Esperteza em escalonamento e paginação quase sempre falhou, com exceção de cargas bem conhecidas como o sistema APL do 360/50.
- **Fim a fim.** Para confiar numa cópia de arquivo, compare o checksum dos bits no disco de destino com o da origem. Em Cambridge, um pacote de disco de 58 MBytes é copiado só com a verificação fim a fim, pois os erros são raros o bastante para que os 20 minutos de trabalho quase nunca se repitam.
- **Logs e atomicidade.** As entradas de log precisam poder ser reexecutadas, com procedimentos de atualização funcionais e argumentos que são valores (o Bravo tem duas funções de atualização, Replace e ChangeProperties). Guardar valores em variáveis é reiniciável e incrementar não é. O Grapevine usa atualizações com carimbo de tempo em que a mais recente vence, uma alternativa mais fraca e mais barata que as ações atômicas.

O que o artigo não afirma: que as dicas são regras, que alguma delas foi testada contra alternativas, que as técnicas não têm custo (ele mesmo aponta os conflitos) ou qualquer coisa sobre redes da escala que viria depois.

## Análise crítica

- **Evidência anedótica, de propósito.** Afirmações como "isso nunca funcionou", sobre otimizar o disco depois do fato, trazem o qualificador "até onde sei", e os motivos de a paginação ter vencido os segmentos são chamados de "complexos e não estudados sistematicamente". Números como o limite de dois terços da capacidade são experiência, não medição.
- **Os slogans puxam em direções opostas.** Guardar segredos entra em conflito com não esconder poder, e o artigo admite isso. O autor avisa que as dicas "não são consistentes" e que "muitas são controversas", então o julgamento sobre quando cada uma vale fica com o leitor.
- **Um contexto de hardware datado.** Os exemplos supõem máquinas com 16 registradores, ciclos de memória de 64 ns (Dorado), rótulos de disco e hardware controlado pelo projetista. As dicas envelhecem melhor que os números.
- **Exemplos autocríticos.** O autor diz que, em retrospecto, a alta largura de banda de E/S do Dorado provavelmente não valeu o custo, e que a funcionalidade extra do Pilot foi comprada a um preço alto.
- **Deslize de citação.** O texto cita a internet Pup como referência [4], que na lista é o artigo do APL/360; o Pup é a [3].
- **Literatura posterior a 1983 (fora deste artigo).** Saltzer, Reed e Clark, "End-to-end arguments in system design" (ACM Transactions on Computer Systems 2(4), novembro de 1984, conferido no Crossref), é a versão de periódico da ideia que o artigo atribui ao trabalho de conferência de 1981 de Saltzer. Lampson também publicou uma versão deste artigo na IEEE Software 1(1), janeiro de 1984, páginas 11 a 28 (conferido no Crossref, não lido), e o mesmo autor postou depois "Hints and Principles for Computer System Design" (arXiv 2011.02455, novembro de 2020; título e data conferidos no arXiv, não lido aqui). No catálogo, o artigo do Dynamo usa "hinted handoff" para um mecanismo diferente das dicas verificáveis descritas aqui, o que mostra como a palavra viaja.

## Pesquisas futuras

- Medir as dicas: para cada slogan, achar sistemas em que seguir a regra compensou e sistemas em que não, em vez de depender de lembrança.
- Estudar onde a verificação fim a fim é barata e onde não é, já que o artigo aponta a necessidade de "um teste barato de sucesso" como limite, junto com defeitos de desempenho que só aparecem sob carga.
- Revisitar "calcule em segundo plano", "processamento em lote" e "descarte carga" para serviços modernos de data center, comparando com o [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) e com as [Falhas metaestáveis](/papers/metastable-failures-in-distributed-systems), sobre laços de realimentação que mantêm um sistema sobrecarregado.
- Ler as seções de log e de ações atômicas ao lado de [Paxos Made Live](/papers/paxos-made-live-engineering-perspective) e de [Viewstamped Replication Revisited](/papers/viewstamped-replication-revisited), que replicam o log que Lampson trata como uma estrutura local única.
- Comparar cada dica com a literatura posterior que nomeia a mesma ideia, começando pelo artigo fim a fim de 1984 e pelo ensaio de 2020 do mesmo autor.
