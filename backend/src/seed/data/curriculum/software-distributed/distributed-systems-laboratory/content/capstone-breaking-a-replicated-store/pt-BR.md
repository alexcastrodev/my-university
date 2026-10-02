---
version: 1.0
updatedAt: 2026-09-12
title: "Capstone: Quebrando uma Store Replicada de Propósito"
summary: "Este capstone roda a store KV-sobre-Raft linearizável concluída do Lab 7 por um único cenário de caos combinado, uma partição de rede dividindo o cluster num lado majoritário e um minoritário, crashes e reinícios concorrentes sobre essa partição, um transporte não confiável que descarta pacotes por toda parte, e deslize de relógio injetado do Lab 8 tudo de uma vez, correspondendo às condições de teste reais e combinadas sob as quais os próprios testes mais difíceis do Lab 4 do MIT 6.5840 rodam, e exige escrever o que foi de fato observado: a partição minoritária corretamente estagna em vez de servir escritas obsoletas, exatamente a troca de disponibilidade-por-consistência que a teoria de CAP e PACELC de todo este currículo já previu, agora confirmada contra um sistema construído à mão em vez de aceito com base na fé."
---
## Objetivos de Aprendizagem

- Combinar todo modo de falha construído ao longo desta disciplina, partição, crash e reinício, perda de pacotes e deslize de relógio, num único cenário de caos simultâneo rodado contra a store replicada concluída.
- Prever, a partir do teorema CAP de `distributed-systems-i` e do PACELC de `distributed-systems-ii`, o que o lado da partição minoritária deveria fazer sob este cenário combinado, e verificar que a implementação de fato o faz.
- Produzir um relatório escrito do que foi de fato observado sob o caos, distinguindo previsões teóricas confirmadas de qualquer bug de implementação genuíno e inesperado que o cenário traz à tona.
- Explicar por que este teste final e combinado é uma barra de correção mais forte do que rodar cada modo de falha individual separadamente, como todo lab anterior fez.

## Contexto e Motivação

Todo lab anterior nesta disciplina testou um modo de falha em relativo isolamento: `raft-persistence-and-crash-recovery` testou crashes, `clock-skew-and-spurious-elections` testou o deslize de timing, `a-linearizable-replicated-kv-store-on-raft` testou partição e falta de confiabilidade, mas nunca bem todos os quatro modos de falha empilhados um sobre o outro numa execução, que é exatamente a condição mais difícil e realista sob a qual os próprios testes mais difíceis do Lab 4 do MIT 6.5840 de fato rodam. Este capstone é onde "quebrá-lo", a segunda metade da descrição de tasks.md de toda esta disciplina, é aplicado por completo, a um sistema que de resto está concluído, não ainda sendo construído.

## Teoria Central

Este capstone não introduz nova lógica de protocolo; é onde **O Teorema CAP: Um Enunciado Preciso** de `distributed-systems-i` e o **PACELC** de `distributed-systems-ii` param de ser previsões lidas de um diagrama e se tornam afirmações que o próprio experimento deste capstone tem de confirmar ou refutar contra um sistema real e em execução. O próprio enunciado preciso do CAP diz que um sistema particionado tem de escolher entre consistência e disponibilidade para requisições que tocam a partição; o `a-linearizable-replicated-kv-store-on-raft` deste lab escolheu consistência, corretamente, pela sua própria garantia de linearizabilidade, o que significa que a previsão específica e falsificável deste capstone é que o lado da partição minoritária tem de se tornar indisponível para escritas, não servir silenciosamente as obsoletas ou conflitantes.

## Exemplos Resolvidos

### O cenário combinado

```go
func TestChaosCapstone(t *testing.T) {
    cfg := MakeConfig(t, 5, net)
    cfg.net.SetUnreliable(0.1)               // perda de pacotes, toda mensagem
    cfg.net.SetClockSkew(cfg.servers, randomSkewPerNode(0, 80*time.Millisecond))

    majority, minority := cfg.partition(3, 2) // divisão 3-2
    go cfg.crashAndRestartRandomly(minority, 500*time.Millisecond) // caos contínuo
                                                                     // no lado minoritário

    majorityResults := runClients(cfg, majority, 20*time.Second)
    minorityResults := runClientsExpectingFailure(cfg, minority, 20*time.Second)

    cfg.healPartition()
    finalCheck := runClients(cfg, cfg.allServers, 5*time.Second)

    verify(majorityResults, minorityResults, finalCheck)
}
```

### O que `verify` de fato tem de confirmar

```text
1. Toda operação que o lado MAJORITÁRIO reporta como bem-sucedida é depois
   visível, corretamente, uma vez que a partição cura — nenhuma escrita do lado
   majoritário é silenciosamente perdida.

2. Toda operação tentada contra o lado MINORITÁRIO ou dá timeout
   ou é explicitamente rejeitada — NENHUMA delas tem sucesso silenciosamente
   contra estado local obsoleto e não replicado. Essa é a previsão de
   CAP/PACELC direta e falsificável que este capstone testa.

3. A história de operações registrada COMPLETA, tentativas majoritárias e
   minoritárias juntas, ainda passa um verificador de linearizabilidade uma vez
   que a partição cura, exatamente como em a-linearizable-replicated-
   kv-store-on-raft, mas agora sob perda de pacotes E deslize de relógio E
   crashes sobre a partição, não qualquer um deles sozinho.
```

### Uma descoberta genuína que este cenário combinado pode trazer à tona e que os testes isolados perdem

```text
Teste de crash isolado (raft-persistence-and-crash-recovery):  passa
Teste de deslize de relógio isolado (clock-skew-and-spurious-elections): passa
Teste de partição isolado (a-linearizable-replicated-kv-store-on-raft): passa

Combinado: um servidor do lado minoritário, reiniciando de um crash ENQUANTO também
experimenta deslize de relógio injetado, brevemente começa uma eleição antes de
o seu estado persistido ter carregado por completo do disco, momentaneamente votando
com um valor de votedFor obsoleto de antes do crash.
```

Esse é exatamente o tipo de efeito de interação que um teste combinado bem projetado consegue pegar e que três testes separados, individualmente passando, não conseguem: o teste de cada lab anterior isolou uma variável especificamente para tornar o efeito daquela variável legível, o que é valioso para construir e depurar incrementalmente, mas não é, por si só, uma afirmação de que a implementação está correta uma vez que todo modo de falha está presente de uma vez, que é a condição real e mais difícil que este capstone de fato checa.

### O relatório escrito

O entregável do lab não é só código que passa, mas um relatório curto e específico cobrindo: se a previsão de CAP/PACELC (Ponto 2 acima) se manteve, com o comportamento de fato observado das requisições do lado minoritário citado diretamente dos logs; se o verificador de linearizabilidade passou na história combinada completa; e, se o cenário combinado trouxe à tona qualquer bug genuíno que um teste isolado tinha perdido (como no exemplo acima), um relato preciso da interação que o causou e do conserto aplicado, conectando a falha observada de volta ao conceito teórico específico, de `distributed-systems-i` ou `distributed-systems-ii`, que a previu ou a explica.

## Equívocos Comuns e Armadilhas

- **"Se todo modo de falha individual passou no seu próprio teste dedicado, o sistema está totalmente correto."** O próprio exemplo resolvido deste capstone mostra uma classe real de bug, uma interação entre dois modos de falha cada um individualmente tratado corretamente, que só um cenário combinado traz à tona; passar em todo teste isolado é necessário, mas não suficiente.
- **"A partição minoritária deveria ainda tentar servir leituras, já que leituras não modificam nada."** Uma leitura obsoleta de um servidor minoritário isolado pode retornar dados já suplantados por escritas com commit no lado majoritário, que é exatamente a troca de disponibilidade-por-consistência que o CAP descreve; a própria garantia de uma store linearizável, já assumida em `a-linearizable-replicated-kv-store-on-raft`, exige rejeitar essas também, não só escritas.
- **"O relatório é uma formalidade; o teste que passa é o que de fato importa."** O relatório é o que conecta um resultado observado e medido de volta a uma afirmação teórica específica, a troca disponibilidade-consistência do CAP, a troca latência-consistência do PACELC, transformando um teste que passa em entendimento confirmado em vez de um sinal verde cuja conexão com a teoria subjacente nunca foi de fato articulada.

## Resumo

Este capstone combina todo modo de falha que esta disciplina construiu separadamente, partição de rede, perda de pacotes, crashes e reinícios de nós, e deslize de relógio, num cenário de caos simultâneo rodado contra a store replicada linearizável concluída de `a-linearizable-replicated-kv-store-on-raft`, correspondendo às condições de teste mais difíceis e combinadas sob as quais os próprios testes mais difíceis do Lab 4 do MIT 6.5840 de fato rodam. A previsão central e falsificável do cenário, extraída diretamente do teorema CAP de `distributed-systems-i` e do PACELC de `distributed-systems-ii`, é que o lado da partição minoritária tem de se tornar indisponível em vez de servir silenciosamente dados obsoletos, e rodar todo modo de falha junto, em vez de cada um em isolamento como todo lab anterior fez, é o que consegue trazer à tona bugs de interação reais, como uma corrida de recuperação de crash contra deslize de relógio injetado, que nenhum único teste isolado jamais pegaria.

## Documentation Links

- [MIT 6.5840 — Lab 4: KV Raft 1](https://pdos.csail.mit.edu/6.824/labs/lab-kvraft1.html): as próprias condições de teste de falha combinada do curso real sobre as quais o cenário de caos deste capstone é modelado.
- [Gilbert & Lynch — Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services (2002)](https://groups.csail.mit.edu/tds/papers/Gilbert/Brewer2.pdf): o enunciado formal da troca consistência-disponibilidade sobre o qual a previsão central deste capstone, e a sua verificação, é construída diretamente.
