import {TableData, Tables} from "./Tables"
import {Util} from "./Util"
import {Expeditie} from "./Expeditie"
import {ObjectID} from "bson"
import randomColor = require("randomcolor")

import RouteDocument = TableData.Route.RouteDocument
import RouteNode = TableData.RouteNode.RouteNode
import RouteEdge = TableData.RouteEdge.RouteEdge
import RouteNodeDocument = TableData.RouteNode.RouteNodeDocument
import {Person} from "./Person"

export namespace Route {
    import ExpeditieOrID = TableData.ExpeditieOrID
    import RouteOrID = TableData.RouteOrID
    import RouteNodeOrID = TableData.RouteNodeOrID
    import PersonOrID = TableData.PersonOrID
    import ExpeditieDocument = TableData.Expeditie.ExpeditieDocument

    export function createRoute(route: TableData.Route.Route): Promise<RouteDocument> {
        return Tables.Route.create(route)
    }

    export function getRouteById(_id: string): Promise<RouteDocument> {
        return Tables.Route.findById(_id).exec()
    }

    export function getRoute(route: RouteOrID): Promise<RouteDocument> {
        return Util.getDocument(route, getRouteById)
    }

    export function getRouteNodesForRoute(route: RouteOrID): Promise<RouteNodeDocument[]> {
        return Tables.RouteNode.find({route: Util.getObjectID(route)}).exec().then(nodes => Promise.all(nodes.map(node => populateRouteNodeColor(node))))
    }

    function createRouteNode(node: RouteNode): Promise<RouteNodeDocument> {
        return Tables.RouteNode.create(node)
    }

    export function setExpeditie(expeditie: ExpeditieOrID): (route: RouteOrID) => Promise<RouteDocument> {
        return route => Tables.Route.findByIdAndUpdate(Util.getObjectID(route), {expeditie: Util.getObjectID(expeditie)}).exec()
    }

    export function populateNodePersons(node: RouteNodeOrID): Promise<RouteNodeDocument> {
        return Util.getDocument(node, getRouteNodeById).then(node => node.populate('persons').execPopulate())
    }

    function getRouteNode(node: RouteNodeOrID): Promise<RouteNodeDocument> {
        return Util.getDocument(node, getRouteNodeById)
    }

    export function getCurrentNodes(route: RouteOrID): Promise<RouteNodeDocument[]> {
        return getRoute(route).then(route => getRouteNodes(route.currentNodes))
    }

    export function getStartingNodes(route: RouteOrID): Promise<RouteNodeDocument[]> {
        return getRoute(route).then(route => getRouteNodes(route.startingNodes))
    }

    function getRouteNodes(nodes: RouteNodeOrID[]): Promise<RouteNodeDocument[]> {
        return Util.getDocuments(nodes, getRouteNodesById)
    }

    function getRouteNodeById(_id: string): Promise<RouteNodeDocument> {
        return Tables.RouteNode.findById(_id).exec().then(populateRouteNodeColor)
    }

    function populateRouteNodeColor(node: RouteNodeOrID): Promise<RouteNodeDocument> {
        return Util.getDocument(node, getRouteNodeById).then(node => {
            return getRouteNodeColor(node).then(color => node.color = color).then(() => node)
        })
    }

    function getRouteNodeColor(node: RouteNodeOrID): Promise<string> {
        return Util.getDocument(node, getRouteNodeById).then(node => {
            if (node.persons.length > 0) {
                const peopleIds = Util.getObjectIDs(node.persons)
                let seed = ""

                for (let id of peopleIds)
                    seed += id.substr(id.length-4, 4)

                return randomColor({seed: seed})
            } else {
                return randomColor()
            }
        })
    }

    function getRouteNodesById(ids: string[]): Promise<RouteNodeDocument[]> {
        return Tables.RouteNode.find({_id: {$in: ids}}).exec()
            .then(nodes => Promise.all(nodes.map(node => populateRouteNodeColor(node))))
    }

    function setNodeEdges(edges: RouteEdge[]): (node: RouteNodeOrID) => Promise<RouteNodeDocument> {
        return node => Tables.RouteNode.findByIdAndUpdate(Util.getObjectID(node), {edges: edges}, {new: true}).exec()
    }

    function getEdgeTo(edge: RouteEdge): Promise<RouteNodeDocument> {
        return getRouteNode(edge.to)
    }

    function getNodeEdges(node: RouteNodeOrID): Promise<RouteEdge[]> {
        return getRouteNode(node).then((node) => node.edges)
    }

    export function setGroups(expeditie: ExpeditieOrID, groups: PersonOrID[][]): Promise<RouteDocument> {
        const groupsIds: string[][] = groups.map(group => Util.getObjectIDs(group))

        const pExpeditie = Util.getDocument(expeditie, Expeditie.getExpeditieById)
        const pRoute = pExpeditie.then(Expeditie.getRoute)
        const pCurrentNodes = pRoute.then(Route.getCurrentNodes)
        const pStartingNodes = pRoute.then(Route.getStartingNodes)
        const pCheckGroups = pCurrentNodes.then(currentNodes => checkGroups(groupsIds, currentNodes))
        const pNewCurrentNodes = Promise.all([pExpeditie, pRoute, pCurrentNodes, pCheckGroups])
            .then(([expeditie, route, currentNodes, checkedGroups]) => createGroups(expeditie, route, currentNodes, checkedGroups))


        return Promise.all([pExpeditie, pRoute, pCurrentNodes, pStartingNodes, pNewCurrentNodes])
            .then(([expeditie, route, oldCurrentNodes, startingNodes, newCurrentNodes]) => {
                route.currentNodes = Util.getObjectIDs(newCurrentNodes)

                if(oldCurrentNodes.length == 0 && startingNodes.length == 0) {
                    route.startingNodes = Util.getObjectIDs(newCurrentNodes)
                } else {
                    let setEdgePromises: Promise<RouteNodeDocument>[] = []
                    let newNodesWithToEdge: string[] = []

                    for(let oldCurrentNode of oldCurrentNodes) {
                        const edges: RouteEdge[] = []

                        for(let newCurrentNode of newCurrentNodes) {
                            if(Util.getObjectID(oldCurrentNode) === Util.getObjectID(newCurrentNode)) {
                                break
                            }

                            for(let oldPersonId of Util.getObjectIDs(oldCurrentNode.persons)) {
                                for(let newPersonId of Util.getObjectIDs(newCurrentNode.persons)) {
                                    if(oldPersonId === newPersonId) {

                                        let existingEdge: RouteEdge = null

                                        for(let edge of edges) {
                                            if(Util.getObjectID(edge.to) === Util.getObjectID(newCurrentNode)) {
                                                existingEdge = edge
                                                break
                                            }
                                        }

                                        if(existingEdge != null) {
                                            existingEdge.people.push(Util.getObjectID(oldPersonId))
                                        } else {
                                            edges.push({
                                                to: Util.getObjectID(newCurrentNode),
                                                people: [oldPersonId]
                                            })

                                            newNodesWithToEdge.push(Util.getObjectID(newCurrentNode))
                                        }
                                    }
                                }
                            }
                        }

                        if(edges.length > 0)
                            setEdgePromises.push(setNodeEdges(edges)(oldCurrentNode))
                    }

                    const newNodesWithoutToEdge = newCurrentNodes.filter(node => !newNodesWithToEdge.includes(Util.getObjectID(node)))

                    if(newNodesWithoutToEdge.length > 0) {
                        route.startingNodes.push(...newNodesWithoutToEdge.map(node => Util.getObjectID(node)))
                    }

                    return Promise.all([route.save(), ...setEdgePromises]).then((res) => res[0])
                }

                return route.save()
            })
    }

    function personArraysEqual(array1: PersonOrID[], array2: PersonOrID[]): boolean {
        const a1 = Util.getObjectIDs(array1).sort()
        const a2 = Util.getObjectIDs(array2).sort()

        for(let person1 of a1) {
            for(let person2 of a2) {
                if(person1 != person2)
                    return false
            }
        }
        return true
    }

    function checkGroups(groups: string[][], currentNodes: RouteNodeDocument[]): Promise<string[][]> {
        const oldGroups: string[][] = currentNodes.map((node) => Util.getObjectIDs(node.persons))

        const newGroupsPersonIds: string[] = [].concat(...groups)

        for(let group of oldGroups) {
            for(let personId of group) {
                if(newGroupsPersonIds.indexOf(personId) < 0) {
                    return Person.getPersonById(personId).then(person =>
                        Promise.reject("The new groups should at least contain all people from the old groups! Person '" + person.name + "' is not specified in the new groups!")
                    )
                }
            }
        }

        if((new Set(newGroupsPersonIds)).size !== newGroupsPersonIds.length) {
            let ids: string[] = []
            const duplicatePeople: string[] = newGroupsPersonIds.filter((id) => {
                const value = ids.includes(id)

                ids.push(id)

                return value
            })

            return Person.getPersonsByIds(duplicatePeople).then(persons => {
                const str = persons.map(person => person.name + " ")

                return Promise.reject("People can't exist in multiple groups at the same time! Duplicates: [" + str + "]")
            })
        }

        return Promise.resolve(groups)
    }

    function createGroups(expeditie: ExpeditieDocument, route: RouteDocument, currentNodes: RouteNodeDocument[], groups: string[][]): Promise<RouteNodeDocument[]> {
        return Promise.resolve().then(() => {
            const personIds: string[] = [].concat(...groups.map((group) => Util.getObjectIDs(group)))

            const peopleNotInExpeditie = personIds.filter((p) => !Util.getObjectIDs(expeditie.participants).includes(p))

            if (peopleNotInExpeditie.length > 0) {
                console.log("Adding as participants: " + peopleNotInExpeditie)
                return Expeditie.addParticipants(peopleNotInExpeditie)(expeditie)
            } else {
                return expeditie
            }
        }).then(expeditie => {
            const newRouteNodes: string[][] = []
            const pRouteNodes: Promise<RouteNodeDocument>[] = []

            for (let group of groups) {
                let groupNeedsNewNode = true
                let nonNewNode = null

                for (let node of currentNodes) {
                    if (personArraysEqual(node.persons, group)) {
                        groupNeedsNewNode = false
                        nonNewNode = node
                        break
                    }
                }

                if (groupNeedsNewNode) {
                    newRouteNodes.push(Util.getObjectIDs(group))
                } else {
                    pRouteNodes.push(getRouteNode(nonNewNode))
                }
            }

            pRouteNodes.push(...newRouteNodes.map((groupIds) => {
                return createRouteNode({
                    route:   Util.getObjectID(route),
                    persons: groupIds,
                    edges:   []
                })
            }))

            return Promise.all(pRouteNodes)
        })
    }

    export function populateRoute(route: RouteOrID): Promise<RouteDocument> {
        return Util.getDocument(route, getRouteById).then(route => {

            return getRouteNodesForRoute(route).then(allNodes => {
                    const map: Map<string, RouteNodeDocument> = new Map()

                    for(let node of allNodes) {
                        map.set(Util.getObjectID(node), node)
                    }

                    const startingNodes = route.startingNodes
                    let currentNodes = route.startingNodes

                    function next(node: RouteNodeOrID, depthLeft: number): Promise<RouteNodeDocument> {
                        if(depthLeft <= 0) {
                            return Promise.reject("Route graph could not be resolved. Either the graph is extremely large or contains circular references.")
                        }
                        node = map.get(Util.getObjectID(node))

                        node.edges.map(edge =>
                            next(edge.to, depthLeft-1).then(to => {
                                edge.to = to
                                return edge
                            })
                        )

                        return Promise.resolve(node)
                    }

                    return Promise.all(route.startingNodes.map(node => next(node, 100))).then((startingNodes) => {
                        route.startingNodes = startingNodes
                        return route
                    })
                })
        })
    }
}