---
title: "A regra da comutatividade escalável: projetando software escalável para processadores multicore"
summary: Clements, Kaashoek, Zeldovich, Morris e Kohler provam que, sempre que as operações de uma interface comutam, existe uma implementação correta delas livre de conflitos de memória compartilhada, e constroem o COMMUTER para transformar isso em testes. Em 13.664 testes gerados para 18 chamadas POSIX, o Linux 3.8 fica livre de conflitos em 68% e o kernel sv6 dos autores em 99%.
researchArea: Sistemas operacionais
keywords: regra da comutatividade escalável, comutatividade SIM, livre de conflitos, escalabilidade multicore, COMMUTER, sv6, POSIX, execução simbólica, coerência de cache
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Que oportunidades fundamentais de escalabilidade estão latentes em interfaces, como as APIs de chamadas de sistema? Será possível identificar oportunidades de escalabilidade antes mesmo de existir qualquer implementação, apenas considerando as especificações das interfaces? Para responder a essas perguntas, o artigo apresenta a seguinte regra: sempre que as operações de uma interface comutam, elas podem ser implementadas de um modo que escala. A regra ajuda os desenvolvedores a construir software mais escalável, do projeto da interface até a implementação, os testes e a avaliação. Para ajudar a aplicá-la, uma nova ferramenta chamada COMMUTER recebe modelos de interface de alto nível e gera testes de operações que comutam e, portanto, poderiam escalar. Com esses testes, o COMMUTER avalia a escalabilidade de uma implementação. Os autores aplicam o COMMUTER a 18 chamadas POSIX e usam os resultados para guiar a implementação de um novo kernel de pesquisa, o sv6. O Linux escala em 68% dos 13.664 testes gerados pelo COMMUTER para essas chamadas, e o COMMUTER encontra muitos problemas que já foram observados limitando a escalabilidade de aplicações. O sv6 escala em 99% dos testes.

## Visão geral

O jeito usual de achar gargalos em multicore é escolher uma carga de trabalho, traçar a vazão contra o número de núcleos e fazer profiling. Os autores listam os problemas: outras cargas ou mais núcleos revelam novos gargalos, não fica claro quais são fundamentais (então o desenvolvedor pode desistir quando existe solução escalável) e tudo acontece tarde, quando correções no nível da interface podem ser inviáveis. O estudo anterior deles, [Uma análise da escalabilidade do Linux em muitos núcleos](/papers/analysis-of-linux-scalability-to-many-cores), é um exemplo desse processo iterativo de projetar, implementar, medir e repetir (leitura minha), e este artigo diz que, sem um jeito de raciocinar sobre escalabilidade no nível da interface, não se sabe quais gargalos restantes do Linux são inerentes à sua interface de chamadas de sistema.

O artigo leva a pergunta para a interface. Ele supõe um multicore de memória compartilhada com coerência do tipo MESI: um núcleo escala em dados que tem em modo exclusivo ou compartilhado, e escrever numa linha tocada por último por outro núcleo não escala. Um conjunto de operações "escala", portanto, quando suas implementações são livres de conflitos, isto é, nenhum núcleo escreve numa linha de cache que outro núcleo leu ou escreveu. O modelo formal de ações e históricos segue a [Linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects) (o artigo cita Herlihy e Wing para isso).

O artigo se diz complementar ao trabalho que usa comutatividade para segurança, como os tipos de dados replicados comutativos ([CRDTs](/papers/conflict-free-replicated-data-types)): aquele trabalho pergunta quando a execução concorrente é segura, este pergunta quando ela escala. Também contrasta com multikernels como o [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), e o próprio sv6 usa [RCU](/papers/read-copy-update-mckenney-ols-2002) para leitores sem lock.

## Contribuição

- **A regra da comutatividade escalável.** Em qualquer situação em que várias operações comutam, isto é, não há como distinguir a ordem de execução pela interface, existe uma implementação cujos acessos à memória são livres de conflitos durante essas operações.
- **Comutatividade SIM.** Uma forma de comutatividade dependente de estado, baseada na interface e monotônica, para que a regra se aplique a interfaces com estado como o POSIX, e não só à comutatividade incondicional.
- **Uma prova construtiva**, que os autores dizem não ser prática como implementação real.
- **Diretrizes para interfaces comutativas (Seção 4).** Decompor operações compostas (`posix_spawn` em vez de `fork` mais `exec`, um `fstat` que devolve campos escolhidos), aceitar o não determinismo da especificação (qualquer descritor livre em vez do menor), permitir ordenação fraca (sockets sem ordem) e liberar recursos de forma assíncrona.
- **O COMMUTER**, formado por ANALYZER, TESTGEN e MTRACE, e o kernel **sv6** com seu sistema de arquivos em memória ScaleFS. O sv6 também contém o RadixVM, de trabalho anterior dos mesmos autores.

## Metodologia

**Formalismo.** Uma execução é um histórico de invocações e respostas de threads. Uma especificação S é um conjunto de históricos bem formados fechado por prefixos. Uma região Y comuta por SI em H = X||Y quando, para qualquer reordenação Y' de Y e qualquer continuação Z, X||Y||Z está em S se e somente se X||Y'||Z está em S. A comutatividade SI não é monotônica: numa interface get/set, `set(1), set(2), set(2)` comuta, mas o prefixo `set(1), set(2)` não. Y comuta por SIM quando todo prefixo de toda reordenação de Y comuta por SI. Uma implementação é uma função de passo de um estado e uma invocação para um novo estado e uma resposta, com ações CONTINUE para a concorrência. Um passo escreve um componente do estado quando o altera e o lê quando ele pode afetar o passo; dois passos em threads diferentes conflitam quando um escreve o que o outro lê ou escreve.

**Regra e prova.** Dada uma especificação com uma implementação de referência correta M e um histórico H = X||Y que M pode gerar, com Y comutativo por SIM, existe uma implementação correta cujos passos em Y são livres de conflitos. A construção primeiro reproduz H a partir de um histórico compartilhado (que conflita), depois mantém um histórico por thread e uma flag de comutação por thread, e, ao divergir, reconstrói o estado de M reexecutando invocações, possivelmente em outra ordem, o que é seguro porque Y comuta.

**COMMUTER.** O ANALYZER executa simbolicamente (com o Z3) um modelo em Python da interface, para cada conjunto de operações (em geral pares), em todas as ordens, e produz as condições em que os valores de retorno e os estados resultantes são equivalentes. O TESTGEN resolve essas condições e emite casos de teste em C, buscando cobertura de caminhos e "cobertura de conflitos" de padrões de acesso diferentes. O MTRACE roda o SO num qemu modificado, registra as leituras e escritas de cada núcleo e reporta os acessos conflitantes com o tipo em C e os stack traces. O modelo cobre 18 chamadas de sistema de arquivos e memória virtual e tem 596 linhas de Python, mais 675 para a geração de testes.

## Resultados

- **Linux 3.8 (ramfs e sua memória virtual).** O COMMUTER gerou 13.664 testes, e a geração mais as execuções no Linux e no sv6 levaram 8 minutos. O Linux é livre de conflitos em 9.389 (68%) e não é em 4.275. Causas citadas: contadores de referência em `struct dentry` e `struct file` (até dois `fstat` no mesmo descritor), lock no diretório pai para qualquer operação que cria nomes e locks grossos na memória virtual. As contagens por par de chamadas estão na Figura 6, um mapa de calor que este resumo não transcreve.
- **sv6.** Livre de conflitos em 13.528 testes (99%), restando 136. O ScaleFS usa alocação por núcleo, double-checked locking, leitores RCU, Refcache e seqlocks, com padrões como radix arrays, adiar trabalho (números de inode nunca são reutilizados), checar de forma otimista antes de travar (`lseek`, `rename`) e não ler o inode quando só a existência importa (`access`).
- **Os 136 casos.** Em sua maioria atualizações idempotentes (dois `lseek` para o mesmo offset, dois `mmap` anônimos com o mesmo endereço fixo e permissões), contagens de referência de descritores de pipe e leituras de arquivos cheios de bytes idênticos. Os autores preferiram deliberadamente a velocidade do caso comum.
- **Hardware (80 núcleos, oito chips Intel E7-8870 de 10 núcleos, prefetcher desligado, média de 3 execuções, variação abaixo de 4%).** Com um `fstatx` que omite a contagem de links, o statbench escala perfeitamente, com zero faltas de L2 no `fstatx`, enquanto o `fstat` não escala nem com contador compartilhado (uma falta de L2 por chamada). Com 80 núcleos o `fstat` custa 3,9 vezes o do Linux. O openbench com `O_ANYFD` escala linearmente e, com um núcleo, o `open` supera o do Linux em 27%. O servidor de e-mail com APIs comutativas atinge escalabilidade de 7,5 vezes de 10 para 80 núcleos, enquanto a versão POSIX colapsa com poucos núcleos. As vazões absolutas por núcleo estão só na Figura 7 (leitura de gráfico, não transcritas).

## Análise crítica

O que o artigo afirma é estreito. A regra diz que uma implementação existe, não que ela é fácil, eficiente ou barata de construir: a construção da prova é "impraticável", sistemas reais usam outras técnicas, e o artigo diz que a comutatividade basta, mas pode não ser necessária (uma interface não comutativa pode escalar em certo hardware). Ele também diz que um conjunto de situações comutativas pode não ter uma única implementação escalável (o exemplo `put`/`max`) e que padrões livres de conflitos ainda podem não escalar se saturarem o barramento de memória. Não afirma nada sobre sistemas distribuídos, só que generalizar deveria ser possível.

Os pontos a seguir são minha leitura da evidência, não afirmações do artigo.

- **Os 99% do sv6 são em parte por construção.** Os autores usaram o COMMUTER para guiar o ScaleFS, então o índice mede o próprio ciclo de projeto deles. Os 68% do Linux são um número mais independente, mas só para o Linux 3.8 e o ramfs.
- **O modelo limita os testes.** Diretórios aninhados estão desligados, tamanhos e offsets têm granularidade de página, e a cobertura de uma implementação só é boa na medida em que ela se parece estruturalmente com o modelo em Python. Linux e sv6 são os dois únicos casos.
- **O custo não é medido.** O sv6 tem 51.732 linhas de código, e os autores optaram por não portar o ScaleFS para o Linux porque ele mexeria em código do kernel inteiro. O artigo não estima o esforço para um kernel já existente.

Literatura posterior, fora deste artigo: a versão estendida saiu na Communications of the ACM 60(8), 2017 (páginas 83 a 90, [doi](https://doi.org/10.1145/3068914), conferida só nos metadados do Crossref, não lida; o item do backlog dizia 2015). Pela entrada do catálogo, o [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) usa o RadixVM como baseline em 384 núcleos, mas só conferi esse texto do catálogo, não o artigo do CortenMM.

## Pesquisas futuras

- Generalizar a regra para sistemas distribuídos, onde o artigo espera relacionar a interface de uma abstração compartilhada à escalabilidade de uma implementação baseada em troca de mensagens.
- Quais interfaces não comutativas ainda escalam (o artigo cita fontes de tempo estritamente crescentes e interconexões que deixam certa comunicação escalar) e quando o acesso livre de conflitos não escala.
- Construções práticas para kernels existentes, já que o sv6 é um sistema novo e o Linux só é avaliado.
- Se os números do Linux se mantêm em kernels atuais, o que o artigo não avalia.
