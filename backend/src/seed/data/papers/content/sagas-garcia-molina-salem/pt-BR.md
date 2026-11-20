---
title: "Sagas"
summary: Garcia-Molina e Salem propõem quebrar uma transação de longa duração em uma sequência de transações comuns, cada uma com uma transação compensadora, para liberar os locks mais cedo e fazer uma execução com falha ser concluída ou desfeita semanticamente em ordem inversa, ao custo da atomicidade e do isolamento completos.
researchArea: Databases
keywords: sagas, transações de longa duração, transações compensadoras, recuperação, pontos de salvamento, atomicidade relaxada, processamento de transações
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Transações de longa duração (LLTs, de long lived transactions) seguram recursos do banco por períodos relativamente longos, atrasando de forma significativa o término de transações mais curtas e mais comuns. Para aliviar esses problemas, os autores propõem a noção de saga. Uma LLT é uma saga se puder ser escrita como uma sequência de transações que podem ser intercaladas com outras transações. O sistema gerenciador de banco de dados garante que todas as transações da saga terminam com sucesso ou que transações compensadoras são executadas para corrigir uma execução parcial. O conceito e a implementação são relativamente simples, mas têm potencial para melhorar bastante o desempenho. O artigo analisa as questões de implementação, inclusive como rodar sagas em um sistema existente que não as suporta diretamente, e discute técnicas de projeto do banco e das LLTs que viabilizam a divisão de LLTs em sagas.

## Visão geral

É um artigo do SIGMOD de 1987 (San Francisco, 27 a 29 de maio; 11 páginas, 249 a 259), do Departamento de Ciência da Computação de Princeton. Vem da época dos SGBDs relacionais centralizados com controle de concorrência por locks, em que uma transação é atômica porque mantém locks sobre tudo o que tocou até o commit. Para transações curtas isso funciona bem. Os exemplos de LLT do artigo são os extratos mensais de um banco, o processamento de sinistros em uma seguradora e estatísticas sobre o banco inteiro. Uma transação assim segura seus locks por horas ou dias, e as outras esperam muito. Os autores acrescentam que a frequência de deadlocks cresce com a quarta potência do tamanho da transação (citando uma análise de Gray e colegas) e que transações longas têm mais chance de encontrar uma falha e ser abortadas. Argumentam que nenhum mecanismo resolve isso enquanto a LLT continua atômica: qualquer que seja o controle de concorrência, uma transação que precisa de um objeto tocado pela LLT não pode confirmar antes dela.

A saída do artigo é relaxar a atomicidade nas transações em que a aplicação permite. Outros papers do catálogo atacam o mesmo custo pelo lado oposto, mantendo transações atômicas e isoladas e fazendo-as escalar: [Percolator](/papers/percolator-large-scale-incremental-processing), [Spanner](/papers/spanner-globally-distributed-database) e [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases). [Life Beyond Distributed Transactions](/papers/life-beyond-distributed-transactions-an-apostates-opinion) limita as transações atômicas a uma única entidade e trata o acordo entre entidades na aplicação. Para as anomalias que a intercalação permite, veja [A Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels).

Vale conhecer antes: transações ACID, two-phase locking, write-ahead logging e undo, e o que faz um procedimento de recuperação após falha.

## Contribuição

- **A saga.** Uma LLT que pode ser escrita como subtransações T1, ..., Tn que podem ser intercaladas de qualquer forma com outras transações. Cada Ti é uma transação real que preserva a consistência do banco, mas as Ti são relacionadas e devem executar como uma unidade (não atômica).
- **Transações compensadoras.** Cada Ti (exceto a última) vem com uma Ci que desfaz os efeitos de Ti do ponto de vista semântico, sem necessariamente restaurar o estado anterior a Ti. No exemplo de companhia aérea do artigo, cancelar uma reserva não grava de volta o número antigo de assentos, porque outras transações podem tê-lo alterado nesse meio tempo.
- **A garantia.** Ou roda T1, T2, ..., Tn (o resultado preferível) ou roda T1, ..., Tj, Cj, ..., C1 para algum j antes do fim. O artigo diz com clareza que outras transações podem ver os efeitos de uma saga parcial e que não se faz nenhum esforço para notificar ou abortar transações que viram Ti antes de Ci rodar.
- **Relação com transações aninhadas.** Uma saga é como uma transação aninhada, mas tem só dois níveis (a saga e transações simples) e não dá atomicidade completa no nível externo.
- **Comandos e um componente de recuperação.** begin-saga, begin-transaction, end-transaction (que leva a identificação da compensadora), abort-transaction, abort-saga, end-saga e um save-point opcional, tratados por um Saga Execution Component (SEC) sobre o Transaction Execution Component (TEC) comum.
- **Orientação de projeto** para transformar LLTs em sagas (Seção 9) e uma forma de rodar sagas sobre um SGBD existente (Seção 7).

## Metodologia

O artigo é de projeto e argumentação. Define a interface do programador e depois percorre o mecanismo: armazenamento confiável do código da aplicação (Seção 3), recuperação para trás (4), recuperação para a frente (5), erros dentro de transações compensadoras (6), execução sobre um SGBD existente (7), sagas paralelas (8) e conselhos de projeto (9). O escopo é um banco centralizado; os autores dizem que deixam sistemas distribuídos de fora por falta de espaço. Exemplos (reservas aéreas, juros bancários, pedidos de compra, a checagem para a formatura de um aluno, a inclusão de tracing no código-fonte de um sistema operacional) ilustram as ideias.

O SEC registra no log todo comando de saga antes de agir e usa o TEC para as transações individuais. Ele não precisa de controle de concorrência próprio, porque as transações que controla podem se intercalar com outras. Supõe-se o log fundido com o do TEC e duplicado. Depois de uma falha, o TEC limpa primeiro as transações pendentes; em seguida o SEC examina cada saga, e uma saga com begin-saga e sem end-saga no log é tratada como abortada. A recuperação para trás executa as compensadoras da última transação executada e de todas as anteriores, em ordem inversa. A recuperação para a frente precisa de cópias confiáveis do código das transações que faltam e de um save-point. Combinar as duas dá a recuperação para trás e para a frente: compensa até o save-point e depois reinicia.

## Resultados

O artigo não traz medições, então o que segue são afirmações de projeto, não resultados.

- **A recuperação puramente para a frente dispensa compensação.** Se os save-points são tomados automaticamente no início de cada transação e abort-saga é proibido, a recuperação para trás nunca é necessária, supondo que cada subtransação acaba tendo sucesso se for repetida vezes suficientes. O artigo sugere o cálculo de juros do banco como candidato.
- **Uma compensadora que falha é um problema real.** Se uma compensadora tem um bug, ela não pode ser abortada com proveito nem concluída. As respostas propostas são recovery blocks (um bloco alternativo de código) ou conserto manual. Durante o conserto manual a saga não segura locks, então não prejudica as outras transações.
- **Sagas rodam sem alterar o SGBD.** Os comandos de saga viram sub-rotinas que guardam o estado em tabelas do banco, e um "saga daemon" faz o trabalho de recuperação do SEC. Isso exige que o SGBD guarde objetos grandes não estruturados (código e save-points), dá mais responsabilidades ao programador e pode piorar o desempenho.
- **Sagas paralelas são possíveis, porém mais difíceis.** Com fork e join passando pelo SEC, as compensações de um filho precisam vir antes das compensações das transações anteriores do pai. A recuperação para a frente pode encontrar save-points inconsistentes (roll-backs em cascata).
- **Compensar nem sempre é possível.** Projetar compensadoras é chamado de "um problema difícil em geral" (disparar um míssil não se desfaz). Muitas ações reais podem ser compensadas, como reservar um carro, enviar uma carta corrigindo a anterior ou mandar ao banco uma ordem de sustar um cheque.
- **O projeto importa.** Se uma LLT guarda dinheiro em uma variável local entre T1 e T3, outras transações veem dados inconsistentes, então o estado temporário deve ficar no banco (por exemplo, uma relação de fundos em trânsito). Os autores recomendam projetar o banco já pensando nas LLTs.
- **A alegação de desempenho é uma crença.** A conclusão diz que sagas "podem ser implementadas com relativamente pouco esforço" e melhoram bastante o desempenho. Nenhuma das duas coisas é medida.

## Análise crítica

A ideia é simples e o artigo é franco sobre seus limites, mas deixa coisas em aberto.

- **Sem avaliação.** Não há implementação, benchmark nem simulação. O benefício vem do argumento de que os locks são mantidos por menos tempo, sustentado apenas pelos argumentos de bloqueio e deadlock da introdução.
- **O isolamento é abandonado, não reparado.** O artigo diz que outras transações podem ver resultados parciais e não são avisadas quando a compensação acontece. Não define quais anomalias isso permite. A Seção 9 dá uma técnica de projeto (guardar o estado intermediário no banco, deixar a transação de auditoria ciente dele), mas nenhum método geral.
- **A compensação é semântica e específica da aplicação.** O programador precisa escrever cada Ci, e o artigo aceita que algumas ações (o míssil e, em certa medida, a carta e o cheque) só se compensam com outra ação no mundo real. Decidir se uma LLT pode ser dividida fica a cargo do julgamento do programador.
- **Só centralizado,** e as seções de recuperação às vezes dependem do programador para a correção (código que sobrevive a falhas, ausência de chamadas de sistema diretas quando roda sobre um SGBD existente).
- **Literatura posterior (não faz parte do artigo de 1987).** O termo hoje é muito usado para operações de negócio que passam por vários serviços sem transação distribuída. A página do padrão em microservices.io, de Chris Richardson (que li), define saga como "a reliably coordinated sequence of local transactions" com transações compensadoras, e lista a falta de rollback automático e a falta de isolamento como desvantagens que exigem "countermeasures". Essa página não cita o artigo de 1987, e não verifiquei em detalhe como o padrão moderno, com seus estilos de orquestração e coreografia, difere do cenário de um único SGBD deste artigo.

## Pesquisas futuras

- Um modelo preciso do que a intercalação com sagas parciais permite, e de quais anomalias de isolamento resultam.
- Métodos para decidir se uma LLT pode ser dividida e para derivar ou verificar transações compensadoras.
- Sagas em sistemas distribuídos, que o artigo deixa explicitamente de fora.
- Compensação de ações com efeitos externos, e o que fazer quando a própria compensadora falha.
- Medições da redução de bloqueios e deadlocks que o artigo apenas argumenta.
