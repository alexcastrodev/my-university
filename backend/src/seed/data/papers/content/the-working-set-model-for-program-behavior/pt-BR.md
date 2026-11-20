---
title: "O modelo de working set para o comportamento de programas"
summary: Denning define o working set W(t, tau) como as páginas que um processo referenciou nos últimos tau segundos de sua execução e o usa como medida da demanda de memória: um programa só deve rodar se seu working set couber na memória, o que liga o gerenciamento de memória ao escalonamento e evita o thrashing.
researchArea: Sistemas operacionais
keywords: working set, memória virtual, paginação, substituição de páginas, thrashing, multiprogramação, gerenciamento de memória, escalonamento
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Provavelmente a razão mais básica para a ausência de um tratamento geral da alocação de recursos nos sistemas computacionais modernos é a falta de um modelo adequado do comportamento dos programas. Neste artigo desenvolve-se um novo modelo, o "modelo de working set". O working set de páginas associado a um processo, definido como o conjunto de suas páginas usadas mais recentemente, fornece o conhecimento vital para a gerência dinâmica de memórias paginadas. Mostra-se que "processo" e "working set" são manifestações da mesma atividade computacional em curso; em seguida definem-se a "demanda de processador" e a "demanda de memória", e a alocação de recursos é formulada como o problema de equilibrar as demandas com o equipamento disponível.

## Visão geral

O artigo foi apresentado no ACM Symposium on Operating System Principles, em Gatlinburg, em outubro de 1967, e publicado na Communications of the ACM, volume 11, número 5, maio de 1968, páginas 323 a 333. Vem do Project MAC, do MIT, na época do "computer utility": máquinas de tempo compartilhado com memória virtual segmentada e paginada, em que muitos programas disputam uma memória principal pequena. A paginação já era comum, mas Denning observa que o escalonamento de processos e o gerenciamento da memória central evoluíram "de forma independente", sem um modelo de como os programas se comportam.

O problema é decidir quais páginas de cada programa devem ocupar a memória principal. O artigo parte do princípio de que o sistema operacional precisa descobrir isso sozinho: considera desaconselhável aceitar conselhos do usuário e argumenta que compiladores não conseguem prever as necessidades de programas modulares cujas partes só são escolhidas em tempo de execução. O cenário é uma memória de dois níveis, com um tempo de travessia T para mover uma página, e o objetivo é minimizar o tráfego de páginas. Vale conhecer antes: paginação por demanda, tabelas de páginas com bits de uso e as políticas de substituição da época (aleatória, FIFO, LRU).

Outros artigos deste catálogo reencontram a ideia por outros lados. O [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) estima o working set de cada máquina virtual por amostragem aleatória, e o [HeMem](/papers/hemem-scalable-tiered-memory-management-for-big-data-applications-and-real-nvm) e o [Memtis](/papers/memtis-efficient-memory-tiering-with-dynamic-page-classification) classificam páginas como quentes ou frias para posicioná-las em camadas. São aproximações minhas, não citações do artigo, que é de 1968 e não cita nenhum deles.

## Contribuição

- **O working set.** W(t, tau) é o conjunto da informação que um processo referenciou no intervalo de tempo de processo (t - tau, t). O parâmetro tau é o parâmetro do working set, e omega(t, tau) é o número de páginas do conjunto. O tempo é o tempo de processo, como o veria um processo que ignora suas suspensões.
- **Quatro propriedades.** Tamanho, previsão, taxa de reentrada e sensibilidade a tau (P1 a P4), enunciadas para programas "típicos", com um modelo probabilístico do intervalo entre referências a uma página.
- **Como detectar o conjunto.** Um temporizador de hardware por página (Apêndice) ou, em software, a amostragem dos bits de uso das entradas da tabela de páginas a cada tau/K segundos, mantendo a página se algum dos últimos K bits de uso estiver ligado.
- **Demanda de memória e escalonamento.** A demanda de memória é o tamanho do working set dividido pelo tamanho da memória (limitado a 1), a demanda de processador vem de um modelo de quanto um processo roda entre interações, e uma política de "equilíbrio" admite os jobs cuja demanda aproxima o sistema de uma fração escolhida da memória e do processador.
- **Processo e working set como uma só computação.** O processo é a demanda por processador, o working set é a demanda por memória, e por isso o gerenciamento de memória e o escalonamento "devem ser atividades intimamente relacionadas".

## Metodologia

O artigo é um modelo e um argumento. Começa revisando as políticas de paginação (aleatória, FIFO, LRU, o detector de laços do ATLAS) e defende que a carga de páginas deve ser por demanda, porque a antecipação pode ser inútil: no programa de interface e rotinas da Figura 6, um bloqueio para interação com o usuário indica que o working set está prestes a mudar. A questão central passa a ser qual página remover.

O modelo supõe que os intervalos entre referências a uma página são independentes e identicamente distribuídos, e deriva a probabilidade de reentrada a partir da função de distribuição F. Para as propriedades, supõe que o working set fica todo na memória, que o processo só é interrompido por faltas de página, que uma página sai da memória no instante em que deixa W(t, tau) e que os working sets não se sobrepõem. A seção 4 esboça uma implementação (listas de prontos, em execução e bloqueados, uma lista cíclica de execução e um processo especial, o "checker", que amostra as tabelas de páginas e mantém um contador do tamanho de cada working set). A seção 6 traz as definições de demanda e de equilíbrio, e o Apêndice um projeto de hardware com um temporizador e um bit de alarme por página.

## Resultados

O artigo traz derivações, não medições próprias. O que segue é o que ele estabelece.

- **Tamanho (P1).** omega(t, 0) = 0, omega cresce monotonicamente com tau e é côncava para baixo, e em média omega(t, 2 tau) é no máximo 2 omega(t, tau).
- **Previsão (P2).** Para uma separação alpha pequena, W(t, tau) é um bom previsor de W(t + alpha, tau); para alpha muito maior que tau, não é.
- **Taxa de reentrada (P3).** O tempo médio de processo entre reentradas de uma página é o intervalo médio entre referências dividido por 1 - F(tau). Com tempo de travessia T, a taxa de reentrada em tempo real é lambda/(1 + lambda T). No equilíbrio de memória, em que os working sets usam uma fração beta das M páginas, o tráfego total de retorno é beta M lambda/(1 + lambda T) e o canal precisa suportar o dobro disso.
- **Escolha de tau.** Um tau pequeno demais remove páginas ainda úteis, um grande demais desperdiça memória. Uma página cujo intervalo entre referências é um pouco maior que tau fica residente só tau/(tau + 2T) do tempo; para mantê-lo perto de 50 por cento, o artigo diz que tau é cerca de 2T, e recomenda um tau comparável a T.
- **Alocação de memória.** Basta conhecer omega(t, tau) com paginação por demanda: antes de rodar um processo, o sistema garante páginas livres suficientes para o working set dele.
- **Thrashing.** O artigo dá o nome: quando working sets demais ocupam a memória, cada um desloca as páginas dos outros, muitos programas ficam parados na espera de página e o canal para a memória auxiliar congestiona. Daí o conselho de equilibrar primeiro a memória e depois o processador.
- **Evidências que cita.** Experimentos de Fine e de Varian e Coffman mostram referências espalhadas por muitas páginas e paginação intensa quando falta memória central; simulações do sistema de tempo compartilhado RCA Spectra 70/46, de Oppenheimer e Weizer, indicariam ganhos marcantes com ideias relacionadas. A conclusão afirma que a seleção aleatória gera o maior tráfego de páginas e o working set o menor, sem uma tabela de números.

## Análise crítica

A ideia de usar o histórico recente para dimensionar a memória de cada programa é clara e as definições são precisas, o que ajuda a explicar por que o termo entrou no vocabulário de sistemas operacionais. Limites que o próprio artigo mostra:

- **Nenhum teste empírico próprio.** A comparação entre aleatória, FIFO, LRU e working set se apoia em argumentos e em estudos de outros autores, e não há números de tráfego de páginas para a política de working set.
- **A palavra "localidade" não aparece.** O modelo depende de as referências se agruparem no tempo, e as propriedades valem para "programas típicos" e "não precisam valer em casos especiais". Um programa sem esse comportamento fica fora do modelo.
- **Escolha e medição só são discutidas.** O tau é recomendado perto do tempo de travessia T, mas as estimativas de reentrada partem da distribuição dos intervalos entre referências, que o artigo não mede, e a amostragem em software é descrita, não construída nem cronometrada. O hardware é uma proposta, e o texto diz que acrescentar hardware a sistemas existentes não é prático.
- **Pendências declaradas.** Como cobrar as páginas compartilhadas quando os working sets se sobrepõem é uma "questão ainda em aberto", a política de equilíbrio está "sob investigação" em uma pesquisa de doutorado, e as interações entre equilíbrio e bom atendimento "ainda não são bem compreendidas".
- **Literatura posterior, marcada como tal e não lida para esta nota.** O Crossref confirma o [Thrashing de Denning (AFIPS 1968)](https://doi.org/10.1145/1476589.1476705), o WSCLOCK de Carr e Hennessy (SOSP 1981, uma substituição estilo relógio baseada em working sets) e "Working Sets Past and Present" de Denning (IEEE TSE, 1980). Conferi só títulos, autores e venues, então não afirmo nada sobre o conteúdo. As políticas de substituição dos kernels modernos estão fora do que li.

## Pesquisas futuras

- Estimar tau e o tamanho do working set automaticamente, e a sensibilidade ao tempo de travessia e ao tamanho da página.
- A política de equilíbrio: como escolher as constantes alpha e beta, como ela troca utilização por tempo de resposta e qual job admitir quando a memória está desequilibrada.
- Cobrança das páginas compartilhadas entre working sets e escalonamento conjunto de processos que compartilham informação.
- Construir o checker de amostragem e os temporizadores de hardware e medir o custo deles em um sistema real.
- Testar o modelo com traços reais de referências, inclusive programas com pouco agrupamento, já que o artigo não traz traços próprios.
