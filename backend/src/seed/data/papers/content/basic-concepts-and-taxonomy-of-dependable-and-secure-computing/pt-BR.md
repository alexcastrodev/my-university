---
title: "Conceitos básicos e taxonomia da computação confiável e segura"
summary: O vocabulário de referência da confiabilidade no sentido de dependability. Define falta, erro e falha como uma cadeia causal, classifica as faltas por oito pontos de vista (inclusive permanente versus transitória), classifica as falhas de serviço e organiza os meios de alcançar a confiabilidade em prevenção, tolerância, remoção e previsão.
researchArea: Sistemas distribuídos
keywords: confiabilidade (dependability), falta, erro, falha, tolerância a falhas, faltas transitórias, faltas intermitentes, taxonomia, modos de falha
version: 1.0
updatedAt: 2026-11-22
---

## Visão geral

Quando engenheiros falam em "falha", muitas vezes querem dizer um bug, uma queda, um deploy ruim ou um disco quebrado, e duas pessoas na mesma reunião podem querer dizer coisas diferentes. Este artigo, que vem de uma linha de trabalho iniciada em 1980 por um comitê conjunto do IEEE e da IFIP, fixa um vocabulário comum. É uma taxonomia, não um artigo de medição: defende que dependability (confiabilidade em sentido amplo) é o conceito guarda-chuva, que a segurança é a preocupação irmã (acrescentando confidencialidade) e que três palavras, falta (fault), erro (error) e falha (failure), nomeiam três elos diferentes de uma mesma cadeia causal.

Li o relatório técnico da Universidade de Maryland (TR 2004-47) do artigo, que é o mesmo texto do artigo da IEEE Transactions on Dependable and Secure Computing. Os autores dizem que não tentam documentar o estado da arte e não tratam de questões de implementação que aparecem em normas. O objetivo é dar um consenso mínimo de conceitos entre comunidades.

## Contribuição

- **Falta, erro, falha.** Uma falha de serviço é um evento em que o serviço entregue se desvia do serviço correto. O desvio no estado do sistema é um erro. A causa julgada ou hipotetizada de um erro é uma falta. Uma falta fica dormente até causar um erro, e então fica ativa. Muitos erros nunca chegam à interface de serviço e nunca viram falha.
- **A falha de um componente é uma falta para o próximo.** Uma falha de serviço do componente A aparece como falta externa para o componente B, que recebe serviço de A, e é assim que os erros se propagam dentro de um sistema e entre sistemas.
- **Confiabilidade e segurança.** Dependability é a capacidade de entregar um serviço em que se pode confiar de forma justificada, ou, na definição alternativa, a capacidade de evitar falhas de serviço mais frequentes ou mais graves do que o aceitável. Seus atributos são disponibilidade, confiabilidade em sentido estrito (reliability), segurança contra catástrofes (safety), integridade e manutenibilidade. A segurança (security) acrescenta a confidencialidade e é uma composição de confidencialidade, integridade e disponibilidade.
- **Classes de faltas.** As faltas são classificadas por oito pontos de vista: fase de criação (desenvolvimento ou operação), fronteira do sistema (interna ou externa), causa fenomenológica (natural ou feita por humanos), dimensão (hardware ou software), objetivo (malicioso ou não), intenção (deliberada ou não), capacidade (acidental ou incompetência) e persistência (permanente ou transitória). Das 256 combinações teóricas, o artigo identifica 31 prováveis.
- **Modos de falha.** As falhas de serviço são classificadas por domínio (conteúdo ou tempo, com falhas de parada e erráticas), por detectabilidade (sinalizada ou não), por consistência (consistente ou inconsistente, sendo a segunda a falha bizantina) e por consequências (de pequena a catastrófica).
- **Meios.** Quatro grupos: prevenção de faltas, tolerância a faltas (detecção de erros e recuperação, com tratamento de erros por retrocesso, avanço ou compensação, e tratamento de faltas por diagnóstico, isolamento, reconfiguração e reinicialização), remoção de faltas e previsão de faltas.

## Metodologia

Não há experimento. O método é conceitual: partir de definições básicas, comentá-las e depois complementá-las com outras mais finas para ameaças, atributos e meios. Os termos são definidos em negrito e o texto mostra como cada um se liga aos demais em uma árvore. O artigo lista sete contribuições novas em relação às versões anteriores da taxonomia, entre elas a relação entre confiabilidade e segurança, uma definição quantitativa de confiabilidade, o critério de capacidade para faltas feitas por humanos (para separar acidente de incompetência), um tratamento atualizado das faltas maliciosas e a distinção entre falhas de serviço e falhas de confiabilidade.

## Resultados

Por ser uma taxonomia, os resultados são as definições e a estrutura que elas formam. Tudo abaixo está dito no texto.

- **A persistência é um dos oito pontos de vista.** Faltas permanentes são aquelas cuja presença se supõe contínua no tempo. Faltas transitórias são aquelas cuja presença é limitada no tempo.
- **Faltas intermitentes agrupam dois tipos de falta.** Faltas de desenvolvimento elusivas e faltas físicas transitórias se parecem quando se manifestam, então ambas são agrupadas como faltas intermitentes, e os erros que produzem costumam ser chamados de erros leves (soft errors).
- **Tolerar cada tipo exige um mecanismo diferente.** O artigo diz que repetir uma computação em canais de projeto idêntico se mostrou adequado para faltas de desenvolvimento elusivas, por retrocesso, mas não serve para faltas de desenvolvimento sólidas. Estas exigem projetos e implementações separados da mesma função, que é a diversidade de projeto.
- **Faltas intermitentes não exigem isolamento.** Na discussão de tolerância a faltas, os autores notam que faltas intermitentes não exigem isolamento nem reconfiguração, e que a recorrência do erro é uma forma de descobrir que a falta não é intermitente.
- **A tolerância a faltas tem limites que o artigo nomeia.** A eficácia é a cobertura de uma técnica. A cobertura imperfeita vem de faltas de desenvolvimento no próprio mecanismo de tolerância ou de hipóteses de faltas que diferem das faltas que realmente ocorrem, inclusive falhas de modo comum quando se supôs independência. O artigo nota que hipóteses conservadoras, como faltas bizantinas, elevam a cobertura ao custo de mais redundância e complexidade, o que pode reduzir a confiabilidade.
- **A confiabilidade pode ser julgada, não só afirmada.** Como um sistema "pode falhar, e normalmente falha", a definição alternativa dá um critério para dizer quando ele ainda conta como confiável, baseado na frequência e na gravidade aceitáveis das falhas de serviço.

## Análise crítica

A força é também o limite: a taxonomia é uma linguagem compartilhada, e uma linguagem não pode estar errada do modo como uma medição pode. Os próprios autores admitem lacunas. Dizem que não surgiu consenso sobre medidas de confiabilidade e segurança, que a confidencialidade não recebe a atenção que merece e que o trabalho precisa de medidas unificadas, de um tratamento mais profundo de confiança e risco e de atenção a novas tecnologias.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **"Transitória" não tem escala de tempo.** Uma falta é transitória quando sua presença é limitada no tempo, mas limitada em relação a quê? Para um programa que tenta de novo, uma falta que dura dez segundos é transitória ou permanente conforme o orçamento de tentativas. A taxonomia dá as classes, mas quem pratica ainda precisa decidir o limiar, e o artigo deixa isso para a hipótese de faltas de cada projeto.
- **Classificar é julgar, não observar.** Uma falta é a causa "julgada ou hipotetizada" de um erro, e o artigo diz que as falhas podem ser subjetivas e discutíveis. Tratar a persistência de uma falta como conhecida no momento em que uma mensagem falha é uma suposição mais forte do que o texto sustenta. A recorrência do erro é a evidência que o artigo oferece, o que significa que a classificação é aprendida depois do fato.
- **Os pontos de vista sobre modos de falha se aplicam a problemas da era da nuvem, mas só em parte.** Falhas de silêncio e de parada, e falhas consistentes versus inconsistentes, antecipam o que [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) chama de falhas percebidas de modo diferente por observadores diferentes, e a definição de falha bizantina como a que os usuários percebem de modo diferente se liga a [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance). O artigo não tem vocabulário para os laços de sobrecarga que se sustentam sozinhos, estudados em [Falhas metaestáveis em sistemas distribuídos](/papers/metastable-failures-in-distributed-systems), em que o gatilho já sumiu e a falha permanece.
- **A detecção de falhas é tratada de forma estrutural.** O artigo nota que detectores podem dar falsos alarmes ou deixar passar falhas, mas não discute os compromissos de tempo e precisão estudados em [Unreliable Failure Detectors for Reliable Distributed Systems](/papers/unreliable-failure-detectors-for-reliable-distributed-systems).

## Pesquisas futuras

- Juntar as classes a dados: com que frequência incidentes reais em serviços de nuvem caem em cada classe, e com que frequência a persistência é conhecida no momento do primeiro erro?
- Estudar como transformar "transitória versus permanente" em uma regra operacional, com janela de observação explícita, e com que frequência essa regra classifica errado.
- Mapear os meios (retrocesso, avanço, compensação, reconfiguração) para os mecanismos de recuperação dos sistemas atuais de mensageria e de jobs.
- Estender os pontos de vista sobre modos de falha para cobrir falhas de desempenho que realimentam a carga, que a taxonomia trata como falha de tempo.
